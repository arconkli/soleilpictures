-- Phase F cleanup — the legacy inbox is replaced by messaging. Drop the
-- table so nothing in the app keeps writing to it.

drop table if exists inbox_items;
