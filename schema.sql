create table if not exists users (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  owner_id text not null references users(id),
  name text not null,
  type text not null check (type in ('boxes','polygons','hands')),
  classes jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists projects_owner_created on projects (owner_id, created_at desc);
delete from projects a using projects b
  where a.owner_id = b.owner_id and a.name = b.name and a.id > b.id;
create unique index if not exists projects_owner_name on projects (owner_id, name);

create table if not exists images (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  s3_key text not null,
  filename text not null,
  objects jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists images_project_created on images (project_id, created_at);
