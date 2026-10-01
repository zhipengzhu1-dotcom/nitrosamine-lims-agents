set local role lims_owner;

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
  constraint commit_key_test_after_claim_fkey foreign key (lab_id, test_id) references lims.test deferrable initially deferred
);

grant select, insert on lims.commit_key to lims_app;
