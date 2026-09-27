export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
};

export type Post = {
  id: number;
  author_id: string | null;
  title: string;
  body: string;
  created_at: string;
  author: Profile | null;
};
