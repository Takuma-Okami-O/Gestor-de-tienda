create schema auth; create schema extensions; create extension pgcrypto schema extensions;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), encrypted_password text, updated_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;
