# Як скинути layout вручну

Якщо потрібно скинути збережені позиції блоків, виконайте в консолі браузера (F12):

```javascript
// Для фінансового звіту
localStorage.removeItem('finance-report-dashboard-layout');
localStorage.removeItem('finance-report-dashboard-layout-version');

// Для фото-звітів
localStorage.removeItem('photo-reports-dashboard-layout');
localStorage.removeItem('photo-reports-dashboard-layout-version');

// Перезавантажити сторінку
location.reload();
```

Або очистити весь localStorage:
```javascript
localStorage.clear();
location.reload();
```


