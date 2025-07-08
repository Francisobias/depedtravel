function parseDMYtoYMD(input) {
  if (!input) return null;
  if (!isNaN(input)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 31));
    const msPerDay = 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + (Number(input) - 1) * msPerDay);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return null;
  }
  const cleaned = input.toString().replace(/[\r\n"']/g, '').trim();
  const parts = cleaned.split(/[/\-\.]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate()) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

module.exports = { parseDMYtoYMD };