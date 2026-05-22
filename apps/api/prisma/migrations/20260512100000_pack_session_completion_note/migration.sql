-- Packer-visible note when completing a pack session (PACKING → PACKED).
ALTER TABLE "pack_sessions" ADD COLUMN "pack_completion_note" TEXT;
