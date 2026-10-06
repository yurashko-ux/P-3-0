// Заливка архіву Altegio. Повторний запуск продовжує з курсора.
import { runAltegioArchive } from "../lib/altegio/archive";

runAltegioArchive()
  .then(() => {
    console.log("[altegio/archive] Скрипт завершився");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[altegio/archive] Скрипт зупинився:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
