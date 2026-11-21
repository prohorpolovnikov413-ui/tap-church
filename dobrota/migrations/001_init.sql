create table if not exists profiles (
  user_id text primary key,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deeds (
  id bigserial primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  title text not null,
  category text not null,
  points integer not null check (points > 0),
  created_at timestamptz not null default now()
);

create index if not exists deeds_user_id_idx on deeds(user_id);
create index if not exists deeds_created_at_idx on deeds(created_at desc);
