// web/app/admin/direct/_components/MasterManager.tsx
// Управління відповідальними (майстрами та дірект-менеджерами)

"use client";

import { useState, useEffect } from "react";

type DirectMaster = {
  id: string;
  name: string;
  telegramUsername?: string;
  role: 'master' | 'direct-manager' | 'admin';
  altegioStaffId?: number;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

type MasterManagerProps = {
  masters: DirectMaster[];
  onMasterUpdated: () => Promise<void>;
};

export function MasterManager({ masters, onMasterUpdated }: MasterManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingMaster, setEditingMaster] = useState<DirectMaster | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    telegramUsername: "",
    role: "master" as 'master' | 'direct-manager' | 'admin',
    altegioStaffId: "",
    order: masters.length + 1,
  });

  const loadMasters = async () => {
    await onMasterUpdated();
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      alert("Введіть ім'я відповідального");
      return;
    }

    try {
      const res = await fetch("/api/admin/direct/masters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          altegioStaffId: formData.altegioStaffId ? parseInt(formData.altegioStaffId, 10) : undefined,
          order: formData.order || masters.length + 1,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFormData({
          name: "",
          telegramUsername: "",
          role: "master",
          altegioStaffId: "",
          order: masters.length + 2,
        });
        setIsCreating(false);
        await loadMasters();
      } else {
        alert(data.error || "Не вдалося створити відповідального");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdate = async () => {
    if (!editingMaster || !formData.name.trim()) {
      alert("Введіть ім'я відповідального");
      return;
    }

    try {
      const res = await fetch("/api/admin/direct/masters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingMaster.id,
          ...formData,
          altegioStaffId: formData.altegioStaffId ? parseInt(formData.altegioStaffId, 10) : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditingMaster(null);
        setFormData({
          name: "",
          telegramUsername: "",
          role: "master",
          altegioStaffId: "",
          order: masters.length + 1,
        });
        setIsModalOpen(false);
        await loadMasters();
      } else {
        alert(data.error || "Не вдалося оновити відповідального");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (masterId: string) => {
    if (!confirm("Видалити відповідального? Це не можна скасувати.")) return;

    try {
      const res = await fetch(`/api/admin/direct/masters?id=${masterId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        await loadMasters();
      } else {
        alert(data.error || "Не вдалося видалити відповідального");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEdit = (master: DirectMaster) => {
    setEditingMaster(master);
    setFormData({
      name: master.name,
      telegramUsername: master.telegramUsername || "",
      role: master.role,
      altegioStaffId: master.altegioStaffId ? String(master.altegioStaffId) : "",
      order: master.order,
    });
    setIsModalOpen(true);
    setIsCreating(false);
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'master': return 'Майстер';
      case 'direct-manager': return 'Дірект-менеджер';
      case 'admin': return 'Адміністратор';
      default: return role;
    }
  };

  return (
    <>
      {/* Кнопка для відкриття модального вікна */}
      <div className="flex justify-end">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setIsModalOpen(true);
            setEditingMaster(null);
            setFormData({
              name: "",
              telegramUsername: "",
              role: "master",
              altegioStaffId: "",
              order: masters.length + 1,
            });
          }}
        >
          + Відповідальний
        </button>
      </div>

      {/* Модальне вікно */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={() => {
            setIsModalOpen(false);
            setIsCreating(false);
            setEditingMaster(null);
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">Управління відповідальними</h3>
                <button
                  className="btn btn-sm btn-circle btn-ghost"
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsCreating(false);
                    setEditingMaster(null);
                  }}
                >
                  ✕
                </button>
              </div>
              
              {/* Форма створення/редагування */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-md font-semibold">
                    {editingMaster ? "Редагувати відповідального" : "Створити нового відповідального"}
                  </h4>
                  {!editingMaster && (
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => setIsCreating(!isCreating)}
                    >
                      {isCreating ? "Сховати форму" : "Показати форму"}
                    </button>
                  )}
                </div>

                {(isCreating || editingMaster) && (
                  <div className="border rounded-lg p-4 bg-base-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label label-text text-xs">Ім'я *</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Наприклад: Олена"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label label-text text-xs">Telegram username</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Наприклад: o_sarbeeva"
                          value={formData.telegramUsername}
                          onChange={(e) => setFormData({ ...formData, telegramUsername: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label label-text text-xs">Роль</label>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={formData.role}
                          onChange={(e) => setFormData({ ...formData, role: e.target.value as 'master' | 'direct-manager' | 'admin' })}
                        >
                          <option value="master">Майстер</option>
                          <option value="direct-manager">Дірект-менеджер</option>
                          <option value="admin">Адміністратор</option>
                        </select>
                      </div>
                      <div>
                        <label className="label label-text text-xs">Altegio Staff ID</label>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full"
                          placeholder="Наприклад: 2658785"
                          value={formData.altegioStaffId}
                          onChange={(e) => setFormData({ ...formData, altegioStaffId: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label label-text text-xs">Порядок сортування</label>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full"
                          value={formData.order}
                          onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={editingMaster ? handleUpdate : handleCreate}
                      >
                        {editingMaster ? "Зберегти" : "Створити"}
                      </button>
                      {editingMaster && (
                        <button
                          className="btn btn-sm btn-ghost ml-2"
                          onClick={() => {
                            setEditingMaster(null);
                            setFormData({
                              name: "",
                              telegramUsername: "",
                              role: "master",
                              altegioStaffId: "",
                              order: masters.length + 1,
                            });
                          }}
                        >
                          Скасувати
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Список існуючих відповідальних */}
              <div>
                <h4 className="text-md font-semibold mb-4">Існуючі відповідальні ({masters.length})</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
                  {masters.length === 0 ? (
                    <div className="col-span-full text-center text-gray-500 py-8">
                      Немає відповідальних. Створіть першого відповідального.
                    </div>
                  ) : (
                    masters.map((master) => (
                      <div
                        key={master.id}
                        className="border rounded-lg p-2 flex items-center justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{master.name}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {getRoleLabel(master.role)}
                            {master.telegramUsername && ` • @${master.telegramUsername}`}
                          </div>
                          {master.altegioStaffId && (
                            <div className="text-xs text-gray-400">ID: {master.altegioStaffId}</div>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => handleEdit(master)}
                            title="Редагувати"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn btn-xs btn-ghost text-error"
                            onClick={() => handleDelete(master.id)}
                            title="Видалити"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
