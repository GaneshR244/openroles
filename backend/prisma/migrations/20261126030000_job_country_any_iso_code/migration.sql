-- Jobs can be in any country now, not only IN, AE and US. Keep the existing values: change the
-- column from the "Country" enum to text in place (Prisma's own draft would drop the column).
-- The index on (status, country, postedAt) is rebuilt automatically.
ALTER TABLE "Job" ALTER COLUMN "country" TYPE TEXT USING "country"::TEXT;

DROP TYPE "Country";
