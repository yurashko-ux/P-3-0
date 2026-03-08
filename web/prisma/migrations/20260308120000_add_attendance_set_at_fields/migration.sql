-- Додаємо consultationAttendanceSetAt та paidServiceAttendanceSetAt
-- Коли встановлено consultationAttended/consultationCancelled та paidServiceAttended/paidServiceCancelled (з вебхуків)
ALTER TABLE "direct_clients" ADD COLUMN "consultationAttendanceSetAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN "paidServiceAttendanceSetAt" TIMESTAMP(3);
