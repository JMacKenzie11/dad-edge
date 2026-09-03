-- The coverage note belongs to Column 5, not to a Column 4 row.
--
-- "No Big Assumption holds this one up yet." is a finding about the
-- assumptions column that points AT a commitment. fixCoverage used to
-- write it onto that commitment's row as sharpen_text, so a man read
-- it in a red box beside his vows, where there is nothing to do about
-- it, while the thing to do sits one section below.
--
-- Worse, nothing cleared it. The row text is written when the
-- commitment is saved or audited; linking an assumption later touches
-- neither. On the map that surfaced this, the note was written at
-- 11:21:34 and the assumption that answered it was linked at 12:10,
-- and the red box was still there.
--
-- fixCoverage no longer writes it (it renders the commitment's OWN
-- findings, or clears the box when there are none). This clears what
-- earlier runs already wrote. Matched on the exact rendered sentence
-- so a row carrying real commitment coaching is untouched.

update itc_commitments
   set sharpen_text = null
 where sharpen_text = 'No Big Assumption holds this one up yet.';
