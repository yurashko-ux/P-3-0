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
  onMasterUpdated: () => Promise<void>;
};

export function MasterManager({ onMasterUpdated }: MasterManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [masters, setMasters] = useState<DirectMaster[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingMaster, setEditingMaster] = useState<DirectMaster | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    telegramUsername: "",
    role: "master" as 'master' | 'direct-manager' | 'admin',
    altegioStaffId: "",
    order: 0,
  });

  useEffect(() => {
    loadMasters();
  }, []);

  const loadMasters = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/direct/masters");
      const data = await res.json();
      if (data.ok) {
        setMasters(data.masters);
      }
    } catch (err) {
      console.error("Failed to load masters:", err);
    } finally {
      setIsLoading(false);
    }
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
        setIsModalOpen(false);
        await loadMasters();
        await onMasterUpdated();
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
          order: 0,
        });
        await loadMasters();
        await onMasterUpdated();
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
        await onMasterUpdated();
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
  };

  const handleCancel = () => {
    setEditingMaster(null);
    setFormData({
      name: "",
      telegramUsername: "",
      role: "master",
      altegioStaffId: "",
      order: masters.length + 1,
    });
    setIsModalOpen(false);
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500">Завантаження...</div>;
  }

  return (
    <>
      {/* Кнопка для відкриття модального вікна */}
      <div className="flex justify-end mb-2">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setEditingMaster(null);
            setFormData({
              name: "",
              telegramUsername: "",
              role: "master",
              altegioStaffId: "",
              order: masters.length + 1,
            });
            setIsModalOpen(true);
          }}
        >
          + Додати відповідального
        </button>
      </div>

      {/* Список відповідальних */}
      <div className="space-y-2">
        {masters.map((master) => (
          <div
            key={master.id}
            className="flex items-center justify-between p-2 bg-base-200 rounded"
          >
            <div className="flex-1">
              <div className="font-semibold">{master.name}</div>
              <div className="text-xs text-gray-500">
                {master.role === 'master' ? 'Майстер' : master.role === 'direct-manager' ? 'Дірект-менеджер' : 'Адміністратор'}
                {master.telegramUsername && ` • @${master.telegramUsername}`}
                {master.altegioStaffId && ` • Altegio ID: ${master.altegioStaffId}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => handleEdit(master)}
              >
                ✏️
              </button>
              <button
                className="btn btn-xs btn-ghost text-error"
                onClick={() => handleDelete(master.id)}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Модальне вікно */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          onClick={handleCancel}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4">
              {editingMaster ? "Редагувати відповідального" : "Додати відповідального"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="label label-text text-xs">Ім'я *</label>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Наприклад: Олена"
                />
              </div>

              <div>
                <label className="label label-text text-xs">Telegram username</label>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  value={formData.telegramUsername}
                  onChange={(e) => setFormData({ ...formData, telegramUsername: e.target.value })}
                  placeholder="Наприклад: o_sarbeeva"
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
                  value={formData.altegioStaffId}
                  onChange={(e) => setFormData({ ...formData, altegioStaffId: e.target.value })}
                  placeholder="Наприклад: 2658785"
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

            <div className="flex justify-end gap-2 mt-6">
              <button className="btn btn-sm" onClick={handleCancel}>
                Скасувати
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={editingMaster ? handleUpdate : handleCreate}
              >
                {editingMaster ? "Зберегти" : "Створити"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
