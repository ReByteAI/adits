-- Drop the user_setup table.
--
-- Background: this table backed the first-login welcome-project bootstrap
-- (server/routes.ts: initializeUserIfNeeded). Each new user got a row
-- here when /me first ran, plus a personalized "<Name>'s Workspace"
-- project with sample files copied from public/samples/welcome/.
--
-- That flow was removed: new users now land on an empty ProjectList and
-- create their own project. With nobody writing to user_setup, the table
-- is dead weight in the schema.

DROP TABLE IF EXISTS user_setup;
