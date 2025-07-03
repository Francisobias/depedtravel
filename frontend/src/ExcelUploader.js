import React from 'react';
import * as XLSX from 'xlsx';

function ExcelUploader() {
  const excelDateToJS = (excelDate) => {
    const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return jsDate.toISOString().split('T')[0]; // yyyy-mm-dd
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      const travels = rows.map(row => ({
        initial: row.Initial || '',
        name: row.Name || '',
        positiondesignation: row.PositionDesignation || '',
        station: row.Station || '',
        purpose: row.Purpose || '',
        host: row.Host || '',
        fromDate: typeof row.DatesFrom === 'number' ? excelDateToJS(row.DatesFrom) : '',
        toDate: typeof row.DatesTo === 'number' ? excelDateToJS(row.DatesTo) : '',
        destination: row.Destination || '',
        area: row.Area || ''
      }));

      const res = await fetch('http://localhost:3000/travels/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(travels)
      });

      const result = await res.json();
      alert(result.message || 'Upload complete!');
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div>
      <h2>Upload Travel Excel</h2>
      <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} />
    </div>
  );
}

export default ExcelUploader;
