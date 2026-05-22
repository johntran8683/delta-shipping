-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN "is_rushed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "delivery_notes_is_rushed_idx" ON "delivery_notes"("is_rushed");

-- CreateTable
CREATE TABLE "dn_rush_history" (
    "id" UUID NOT NULL,
    "delivery_note_id" UUID NOT NULL,
    "from_rushed" BOOLEAN NOT NULL,
    "to_rushed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "dn_rush_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dn_rush_history_delivery_note_id_changed_at_idx" ON "dn_rush_history"("delivery_note_id", "changed_at" DESC);

-- AddForeignKey
ALTER TABLE "dn_rush_history" ADD CONSTRAINT "dn_rush_history_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dn_rush_history" ADD CONSTRAINT "dn_rush_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dn_rush_history" ADD CONSTRAINT "dn_rush_history_actor_role_id_fkey" FOREIGN KEY ("actor_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
