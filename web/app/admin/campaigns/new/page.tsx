// web/app/admin/campaigns/new/page.tsx
// ...усе як було вище...
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        base_pipeline_id: basePipelineId,
        base_status_id: baseStatusId,
        v1_field: 'text',
        v1_op: 'contains',
        v1_value: v1Value.trim(),
        v1_to_pipeline_id: v1ToPipelineId,
        v1_to_status_id: v1ToStatusId,
        v2_enabled: v2Enabled,
        v2_field: 'text',
        v2_op: 'contains',
        v2_value: v2Value.trim(),
        v2_to_pipeline_id: v2Enabled ? v2ToPipelineId : null,
        v2_to_status_id: v2Enabled ? v2ToStatusId : null,
        exp_days: Number(expDays),
        exp_to_pipeline_id: expToPipelineId || null,
        exp_to_status_id: expToStatusId || null,
        enabled: true,
      };

      // ❗️стріляємо ТІЛЬКИ в /api/campaigns
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch {}
      if (!res.ok || (j?.ok === false)) {
        throw new Error(j?.error || `${res.status}`);
      }

      alert('Кампанію збережено');
      window.location.href = '/admin/campaigns?created=1';
      return;
    } catch (e: any) {
      console.error(e);
      alert(`Помилка збереження: ${e?.message ?? 'unknown'}`);
    } finally {
      setSaving(false);
    }
  }
// ...решта без змін...
