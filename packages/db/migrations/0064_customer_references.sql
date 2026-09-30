-- Review fix 17, after the compliance review: a Sample names its Customer's own Product and a
-- Test its Customer's own Sample, as composite foreign keys, so no writer, Customer or Lab, can
-- attach one Customer's item to another's. The portal views filter on the row's own customer_id
-- and would otherwise show the other Customer's Product or Sample through such a row.
alter table lims.product add unique (id, customer_id);
alter table lims.sample add foreign key (product_id, customer_id) references lims.product (id, customer_id);
alter table lims.sample add unique (lab_id, id, customer_id);
alter table lims.test add foreign key (lab_id, sample_id, customer_id) references lims.sample (lab_id, id, customer_id);
