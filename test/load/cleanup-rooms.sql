\set ON_ERROR_STOP on

BEGIN;

DELETE FROM properties
WHERE owner_profile_id IN (
  SELECT o.id
  FROM owner_profiles o
  JOIN users u ON u.id = o.user_id
  WHERE u.email LIKE 'load-seed-%@example.com'
);

DELETE FROM users WHERE email LIKE 'load-seed-%@example.com';

COMMIT;

VACUUM ANALYZE users;
VACUUM ANALYZE owner_profiles;
VACUUM ANALYZE properties;
VACUUM ANALYZE property_media;
VACUUM ANALYZE rooms;
VACUUM ANALYZE room_media;

SELECT count(*) AS remaining_load_seed_users
FROM users
WHERE email LIKE 'load-seed-%@example.com';
