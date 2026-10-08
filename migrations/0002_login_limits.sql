CREATE TABLE login_limits (bucket TEXT NOT NULL, window INTEGER NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY (bucket, window));
