-- Einmalig im Supabase SQL-Editor ausführen (Dashboard → SQL Editor → New query).
-- Legt die drei Tabellen des Finanz-Trackers an und sorgt per Row Level Security
-- dafür, dass jeder Nutzer ausschließlich seine eigenen Daten lesen/schreiben kann.

create table public.kategorien (
  user_id uuid    not null references auth.users (id) on delete cascade,
  name    text    not null,
  level   int     not null check (level between 1 and 3),
  aktiv   boolean not null default true,
  pos     serial,                -- Einfüge-Reihenfolge = Anzeige-Reihenfolge
  primary key (user_id, name)
);

create table public.wochen (
  user_id uuid    not null references auth.users (id) on delete cascade,
  jahr    int     not null,
  kw      int     not null check (kw between 1 and 53),
  lohn    boolean not null default false,
  primary key (user_id, jahr, kw)
);

create table public.daten (
  user_id   uuid    not null references auth.users (id) on delete cascade,
  jahr      int     not null,
  kw        int     not null check (kw between 1 and 53),
  kategorie text    not null,
  wert      numeric not null,
  primary key (user_id, jahr, kw, kategorie)
);

alter table public.kategorien enable row level security;
alter table public.wochen     enable row level security;
alter table public.daten      enable row level security;

create policy "Nutzer sehen nur eigene Kategorien"
  on public.kategorien for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Nutzer sehen nur eigene Wochen"
  on public.wochen for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Nutzer sehen nur eigene Daten"
  on public.daten for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
