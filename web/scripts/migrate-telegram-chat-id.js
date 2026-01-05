// web/scripts/migrate-telegram-chat-id.js
// Скрипт для виконання міграції зміни типу telegramChatId з Int на BigInt

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Перевірка поточного типу колонки telegramChatId...');
  
  try {
    // Перевіряємо поточний тип колонки
    const columnInfo = await prisma.$queryRawUnsafe(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'direct_masters' 
      AND column_name = 'telegramChatId'
    `);
    
    if (columnInfo && columnInfo.length > 0) {
      const currentType = columnInfo[0].data_type;
      console.log(`📊 Поточний тип колонки: ${currentType}`);
      
      if (currentType === 'bigint' || currentType === 'BIGINT') {
        console.log('✅ Колонка вже має тип BIGINT! Міграція не потрібна.');
        return;
      }
    }
    
    console.log('\n🔄 Виконання міграції...');
    
    // Виконуємо міграцію
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "direct_masters" 
      ALTER COLUMN "telegramChatId" TYPE BIGINT 
      USING "telegramChatId"::BIGINT
    `);
    
    console.log('✅ Міграція виконана успішно!');
    
    // Перевіряємо результат
    console.log('\n🔍 Перевірка результату...');
    const resultInfo = await prisma.$queryRawUnsafe(`
      SELECT 
        column_name, 
        data_type
      FROM information_schema.columns 
      WHERE table_name = 'direct_masters' 
      AND column_name = 'telegramChatId'
    `);
    
    if (resultInfo && resultInfo.length > 0) {
      console.log(`📊 Новий тип колонки: ${resultInfo[0].data_type}`);
    }
    
    // Перевіряємо майстрів з chatId
    const mastersWithChatId = await prisma.directMaster.findMany({
      where: { telegramChatId: { not: null } },
      select: { id: true, name: true, telegramChatId: true },
    });
    
    console.log(`\n👥 Знайдено ${mastersWithChatId.length} майстрів з telegramChatId`);
    if (mastersWithChatId.length > 0) {
      console.log('Приклади:');
      mastersWithChatId.slice(0, 3).forEach(m => {
        console.log(`  - ${m.name}: ${m.telegramChatId}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Помилка міграції:', error);
    if (error.message && error.message.includes('must be owner')) {
      console.error('\n⚠️ Помилка прав доступу. Потрібні права власника таблиці.');
      console.error('Спробуйте виконати SQL команду вручну через інтерфейс бази даних:');
      console.error('ALTER TABLE "direct_masters" ALTER COLUMN "telegramChatId" TYPE BIGINT USING "telegramChatId"::BIGINT;');
    }
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Помилка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

