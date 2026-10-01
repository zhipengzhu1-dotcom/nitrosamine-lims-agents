set local role lims_owner;

-- One row per committed press: the Commit Key the client chose, what it asked for, and the receipt it was given.
-- A Commit Key is unique in its Lab, so a key resent from another session finds this row instead of committing again.
-- Not audited, like the session: the commit it guards is in the Audit Trail, and the key is not a record.
-- The Test is checked at commit, because submit claims its key before it inserts the Test.
create table lims.commit_key (
  lab_id       uuid            not null references lims.lab,
  key          uuid            not null,
  session_id   uuid            not null,
  request      jsonb           not null,
  test_id      uuid            not null,
  state        lims.test_state not null,
  committed_at timestamptz     not null default clock_timestamp(),
  primary key (lab_id, key),
  foreign key (lab_id, session_id) references lims.session,
  foreign key (lab_id, test_id) references lims.test deferrable initially deferred
);

grant select, insert on lims.commit_key to lims_app;
