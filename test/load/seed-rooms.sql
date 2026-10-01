\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email LIKE 'load-seed-%@example.com') THEN
    RAISE EXCEPTION 'A massa de carga já existe. Execute npm run load:cleanup antes de gerar outra.';
  END IF;
END $$;

CREATE TEMP TABLE load_owners ON COMMIT DROP AS
  SELECT gen_random_uuid() AS user_id, gen_random_uuid() AS owner_profile_id, n
  FROM generate_series(1, GREATEST(1, (:properties) / 2)) n;

INSERT INTO users (id, name, email, status, roles, updated_at)
  SELECT user_id, 'Carga ' || n, 'load-seed-' || user_id || '@example.com',
         (CASE WHEN n % 20 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END)::"UserStatus",
         ARRAY['OWNER']::"Role"[], now()
  FROM load_owners;

INSERT INTO owner_profiles (id, user_id, updated_at)
  SELECT owner_profile_id, user_id, now() FROM load_owners;

CREATE TEMP TABLE load_properties ON COMMIT DROP AS
  SELECT gen_random_uuid() AS id, o.owner_profile_id, p.n
  FROM generate_series(1, :properties) p(n)
  JOIN load_owners o ON o.n = 1 + (p.n % (SELECT count(*) FROM load_owners));

INSERT INTO properties (id, owner_profile_id, status, type, title, description, house_rules, features,
                        neighborhood, city, state, reference_points, updated_at)
  SELECT id, owner_profile_id,
         (CASE WHEN n % 7 = 0 THEN 'UNAVAILABLE' WHEN n % 11 = 0 THEN 'DRAFT' ELSE 'ACTIVE' END)::"PropertyStatus",
         'HOUSE', 'Imóvel de carga ' || n, 'Descrição de carga',
         CASE WHEN n % 2 = 0 THEN 'Silêncio após 22h' END,
         CASE WHEN n % 3 = 0 THEN ARRAY['WIFI'] ELSE ARRAY[]::text[] END,
         'Centro', 'São Paulo', 'SP',
         CASE WHEN n % 4 = 0 THEN ARRAY['Metrô'] ELSE ARRAY[]::text[] END,
         now()
  FROM load_properties;

INSERT INTO property_media (property_id, type, storage_key, mime_type, size_bytes, position)
  SELECT p.id, 'IMAGE', 'load-seed/' || gen_random_uuid() || '.png', 'image/png', 1000, k
  FROM load_properties p, generate_series(0, 2) k;

CREATE TEMP TABLE load_rooms ON COMMIT DROP AS
  SELECT gen_random_uuid() AS id, p.id AS property_id, row_number() OVER () AS n
  FROM load_properties p, generate_series(1, 4) k;

INSERT INTO rooms (id, property_id, status, title, description, price_cents, capacity, bathroom_type,
                   accepted_audiences, amenities, additional_info, featured_from, featured_until, updated_at)
  SELECT id, property_id,
         (CASE WHEN n % 5 = 0 THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END)::"RoomStatus",
         'Quarto de carga ' || n,
         CASE WHEN n % 2 = 0 THEN 'Quarto arejado' END,
         10000 + (n % 50) * 100, 2, 'PRIVATE', ARRAY['WOMAN']::"GenderIdentity"[],
         CASE WHEN n % 3 = 0 THEN ARRAY['DESK'] ELSE ARRAY[]::text[] END,
         CASE WHEN n % 6 = 0 THEN 'Check-in após 14h' END,
         CASE WHEN n % 100 = 1 THEN (now() AT TIME ZONE 'UTC') - interval '1 day' END,
         CASE WHEN n % 100 = 1 THEN (now() AT TIME ZONE 'UTC') + interval '7 days' END,
         now()
  FROM load_rooms;

INSERT INTO room_media (room_id, type, storage_key, mime_type, size_bytes, position)
  SELECT r.id, 'IMAGE', 'load-seed/' || gen_random_uuid() || '.png', 'image/png', 1000, k
  FROM load_rooms r, generate_series(0, 1) k
  WHERE r.n % 2 = 0;

COMMIT;

ANALYZE users;
ANALYZE owner_profiles;
ANALYZE properties;
ANALYZE property_media;
ANALYZE rooms;
ANALYZE room_media;

SELECT count(*) AS rooms_seeded,
       count(*) FILTER (WHERE r.status = 'AVAILABLE') AS rooms_available
FROM rooms r
JOIN properties p ON p.id = r.property_id
JOIN owner_profiles o ON o.id = p.owner_profile_id
JOIN users u ON u.id = o.user_id
WHERE u.email LIKE 'load-seed-%@example.com';
