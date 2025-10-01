'use client';

import { useState } from 'react';

export default function NewCampaignPage() {
  const [pipelineId, setPipelineId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [pipelineName, setPipelineName] = useState('');
  const [statusName, setStatusName] = useState('');

  // ...ваші інші стейти (назва, v1, v2, expire тощо)

  return (
    <form action="/api/campaigns" method="post" className="space-y-4">
      {/* Назва */}
      <input name="name" placeholder="Назва кампанії" className="input" />

      {/* Базова воронка */}
      <select
        name="basePipelineId"
        value={pipelineId}
        onChange={(e) => {
          setPipelineId(e.target.value);
          const label = e.target.selectedOptions[0]?.text ?? '';
          setPipelineName(label);
        }}
        className="select"
        required
      >
        {/* тут ваші <option value="ID">Назва воронки</option> */}
      </select>

      {/* Базовий статус */}
      <select
        name="baseStatusId"
        value={statusId}
        onChange={(e) => {
          setStatusId(e.target.value);
          const label = e.target.selectedOptions[0]?.text ?? '';
          setStatusName(label);
        }}
        className="select"
        required
      >
        {/* тут ваші <option value="ID">Назва статусу</option> */}
      </select>

      {/* приховані поля з назвами — підуть у POST */}
      <input type="hidden" name="basePipelineName" value={pipelineName} />
      <input type="hidden" name="baseStatusName" value={statusName} />

      {/* решта ваших полів (v1/v2/expire тощо) */}

      <button type="submit" className="btn btn-primary">Зберегти</button>
    </form>
  );
}
