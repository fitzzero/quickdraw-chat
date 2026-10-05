-- 4.x's createDocument listed the owner in the document's own access list as
-- Admin. 5.0's policy gives the owner Admin from owner_id and its create writes
-- an empty list, so the sharing kit's listShares answers the shares only: drop
-- the owner's entry from the documents written before, keeping the others in
-- their order. A data change only; the schema is as it was.
UPDATE "documents" AS d
SET "acl" = COALESCE(
  (
    SELECT jsonb_agg(e.entry ORDER BY e.ord)
    FROM jsonb_array_elements(d."acl") WITH ORDINALITY AS e(entry, ord)
    WHERE e.entry ->> 'userId' IS DISTINCT FROM d."owner_id"
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(d."acl") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d."acl") AS e(entry)
    WHERE e.entry ->> 'userId' = d."owner_id"
  );
