// Перевірка, чи запит з Vercel preview-деплою (доступ без логіну)

export function isPreviewDeploymentHost(host: string): boolean {
  return (
    host.endsWith('.vercel.app') &&
    host !== 'p-3-0.vercel.app' &&
    host !== 'cresco-crm.vercel.app'
  );
}
