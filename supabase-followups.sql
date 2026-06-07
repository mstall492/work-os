create table if not exists followups (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users(id),
    title text not null,
    org text,
    due_date date,
    status text default 'Open',
    notes text,
    created_at timestamptz default now()
);

alter table followups enable row level security;

drop policy if exists "Users can manage own followups" on followups;
create policy "Users can manage own followups"
on followups for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
