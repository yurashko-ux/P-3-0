<form action="/api/campaigns/delete" method="post">
  <input type="hidden" name="id" value={item.id} />
  <button
    type="submit"
    className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
    aria-label={`Видалити кампанію ${item.id}`}
  >
    Видалити
  </button>
</form>
