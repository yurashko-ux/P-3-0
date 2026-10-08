-- Архів неактуальних рахунків Altegio (Каса, оплата, документи).

CREATE TABLE "hidden_finance_accounts" (
    "altegioAccountId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenBy" TEXT,

    CONSTRAINT "hidden_finance_accounts_pkey" PRIMARY KEY ("altegioAccountId")
);
