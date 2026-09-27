-- Seed: large enough that the missing indexes hurt.
-- 20 real-looking ideas at the top of the feed (ids 1-20, newest first) with named authors and
-- vote counts, then 1,000 generic profiles, 9,980 generated posts (~1.5 KB body each) and
-- 50,000 random votes (sized for the demo caps in scripts/cap.sh). Applied by `supabase db reset` (and by the first `supabase start`).

-- The 20 ideas. One per line: (n, author username, title, body, votes). Keep this shape:
-- _tools/mock-supabase.mjs reads these lines to show the same ideas without Docker.
create temp table seed_ideas (n int, username text, title text, body text, votes int);
insert into seed_ideas values
  (1, 'sam_ships', 'DogTranslate', 'An AI collar that turns your dog barks into text messages. Never wonder what Rex wants again. The premium tier adds sarcasm detection, because some dogs have it.', 214),
  (2, 'leafy_lena', 'Plant Parent Pro', 'Point your camera at a houseplant and learn why it is dying. Push notifications come from the plant itself, so you feel exactly the right amount of guilt.', 187),
  (3, 'tired_tom', 'Nap Pods for Offices', 'Sleep pods delivered to open-plan offices and rented by the hour. HR-approved naps, billed to the company, snoring not included.', 162),
  (4, 'chef_nadia', 'Fridge Roulette', 'Scan your fridge and get a recipe from whatever is about to expire. Less food waste, fewer decisions, one swipe before dinner.', 151),
  (5, 'bench_press_ben', 'Gym Buddy Rental', 'Book a stranger to spot you at the gym and pretend you are old friends. Buddies are rated by encouragement level and high-five quality.', 139),
  (6, 'remote_rita', 'Meeting Escape Button', 'A browser extension that fakes a network outage when a meeting runs over. Ships with realistic audio glitches and a sad webcam freeze.', 133),
  (7, 'paws_priya', 'Pet Dating', 'Swipe right on a walk date at the park, run by the owners on behalf of their dogs. Cats will be added once they agree to anything.', 121),
  (8, 'kind_kenji', 'Rent-a-Grandma', 'Video calls with retired grandmothers who tell you your startup idea is wonderful and ask if you have eaten today. Unlimited plan available.', 118),
  (9, 'burnout_bea', 'Micro-Sabbatical', 'Book a one-week career break with everything arranged: a cabin, no Wi-Fi, a paper journal and an auto-reply that sounds important.', 104),
  (10, 'spin_cycle_sid', 'Laundry Roulette', 'Subscription laundry where you get back someone elses clothes in your size. Zero-waste fashion discovery, one wash at a time.', 97),
  (11, 'urban_uma', 'Parking Karma', 'Earn points for leaving a parking spot at the time you promised and spend them to reserve one. City parking as a marketplace.', 91),
  (12, 'dev_dmitri', 'Excuse Generator API', 'One endpoint, plausible excuses in 14 languages, ranked by believability. The enterprise plan adds excuses for the excuses.', 86),
  (13, 'metro_maya', 'Silent Disco Commute', 'Synced playlists for everyone on the same train car. Vote on the next track and meet your neighbours without saying a word.', 78),
  (14, 'sunday_sofia', 'Grandpa Recipes', 'Record your grandparents cooking once and get a step-by-step recipe with their voice guiding you, forever.', 74),
  (15, 'green_gabe', 'Vegan Dog Food Club', 'Vet-approved plant-based meals for dogs, delivered monthly. The opinion of the dog is not included in the subscription.', 66),
  (16, 'deep_work_dan', 'Focus Cafe', 'A cafe where your phone is locked in a box at the door and the espresso is free until you open it.', 59),
  (17, 'flatmate_fiona', 'Roommate Court', 'Submit a dispute about the dishes and get a binding verdict from three random strangers within an hour. Appeals cost extra.', 52),
  (18, 'style_sasha', 'Weather Wardrobe', 'Tells you what to wear each morning based on the forecast and on what is actually clean in your closet.', 47),
  (19, 'little_ceo_liam', 'Kids Startup Camp', 'A summer camp where ten-year-olds pitch lemonade stands to real investors. The investors are also ten.', 41),
  (20, 'fixit_farah', 'Neighbourhood Tool Library', 'Borrow a drill from the person next door through an app instead of buying one you use twice a year.', 38);

insert into profiles (username)
select username from seed_ideas order by n;

insert into profiles (username)
select 'user_' || g from generate_series(1, 1000) g;

-- Ids 1-20, created 1-20 minutes ago, so they are the newest 20 in the feed.
insert into posts (author_id, title, body, created_at)
select p.id, i.title, i.body, now() - (i.n || ' minutes')::interval
from seed_ideas i
join profiles p on p.username = i.username
order by i.n;

-- The rest: same as before, generated.
with p as (select array_agg(id) as ids from profiles where username like 'user\_%')
insert into posts (author_id, title, body, created_at)
select p.ids[1 + (g % 1000)],
       'Idea #' || g,
       repeat('This startup will change everything. ', 40),
       now() - (g || ' minutes')::interval
from p, generate_series(21, 10000) g;

-- Votes for the 20 ideas, then 50,000 random votes over all posts.
insert into votes (post_id)
select p.id
from seed_ideas i
join posts p on p.title = i.title,
     generate_series(1, i.votes);

insert into votes (post_id)
select 1 + floor(random() * 10000)::int
from generate_series(1, 50000);

drop table seed_ideas;
