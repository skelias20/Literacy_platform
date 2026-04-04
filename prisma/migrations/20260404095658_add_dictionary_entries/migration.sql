-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "word" TEXT NOT NULL,
    "pronunciation" TEXT,
    "partOfSpeech" TEXT,
    "definition" TEXT NOT NULL,
    "extraDefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("word")
);
