CREATE TABLE "new_api_identities" (
    "userId" TEXT NOT NULL,
    "newApiUserId" INTEGER,
    "tokenCiphertext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "new_api_identities_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "new_api_identities_newApiUserId_key"
    ON "new_api_identities"("newApiUserId");

ALTER TABLE "new_api_identities"
    ADD CONSTRAINT "new_api_identities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
