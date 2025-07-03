import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import './TravelAuthority.css';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend);

// Initial form state
const initialFormState = {
  employeeID: '',
  positiondesignation: '',
  station: '',
  purpose: '',
  host: '',
  fromDate: '',
  toDate: '',
  destination: '',
  area: '',
  sof: '',
  attachment: null,
  attachmentPreview: null,
};

// Format date as MM/DD/YYYY
const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 'N/A' : `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
};

// Current date and time (04:47 PM PST, June 30, 2025)
const currentDateTime = new Date('2025-06-30T16:47:00-07:00');

const monthOptions = [
  { value: '', label: 'All Months' },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: new Date(0, i).toLocaleString('en-US', { month: 'long' }),
  })),
];

const createPrintTemplate = (entry) => `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Travel Entry - ${entry.Name || 'Unnamed'}</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; }
      .print-container { width: 100%; max-width: 800px; margin: 0 auto; }
      .header { text-align: center; margin-bottom: 20px; }
      .header h2 { font-size: 18pt; margin: 0; }
      .header p { font-size: 10pt; color: #555; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { border: 1px solid #000; padding: 8px; text-align: left; }
      th { background: #f2f2f2; font-weight: bold; }
      .footer { text-align: center; font-size: 8pt; color: #777; margin-top: 20px; }
      @page { margin: 1in; }
      a { color: #0066cc; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="print-container">
      <div class="header">
        <h2>Travel Entry Details - ${entry.Name || 'Unnamed'}</h2>
        <p>Generated on: ${currentDateTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: true })} PST</p>
      </div>
      <table>
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Name</td><td>${entry.Name || 'N/A'}</td></tr>
        <tr><td>Position</td><td>${entry.PositionDesignation || 'N/A'}</td></tr>
        <tr><td>Initial</td><td>${entry.Initial || 'N/A'}</td></tr>
        <tr><td>Station</td><td>${entry.Station || 'N/A'}</td></tr>
        <tr><td>Purpose</td><td>${entry.Purpose || 'N/A'}</td></tr>
        <tr><td>Host</td><td>${entry.Host || 'N/A'}</td></tr>
        <tr><td>Dates</td><td>${formatDate(entry.DatesFrom)} to ${formatDate(entry.DatesTo)}</td></tr>
        <tr><td>Destination</td><td>${entry.Destination || 'N/A'}</td></tr>
        <tr><td>Area</td><td>${entry.Area || 'N/A'}</td></tr>
        <tr><td>Source of Funds</td><td>${entry.sof || 'N/A'}</td></tr>
        <tr><td>Employee ID</td><td>${entry.employee_ID || 'N/A'}</td></tr>
        ${entry.Attachment ? `<tr><td>Attachment</td><td><a href="http://localhost:3000${entry.Attachment}" target="_blank">View PDF</a></td></tr>` : ''}
      </table>
      <div class="footer">
        <p>Travel Authority Database - Printed on ${currentDateTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: true })} PST</p>
      </div>
    </div>
  </body>
  </html>
`;

const TravelAuthority = () => {
  const [form, setForm] = useState(initialFormState);
  const [editingId, setEditingId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [graphSearch, setGraphSearch] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [graphType, setGraphType] = useState('year');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [graphData, setGraphData] = useState({ labels: [], datasets: [] });
  const [notification, setNotification] = useState({ message: '', type: '' });
  const [preUploadEntries, setPreUploadEntries] = useState([]);
  const [showRollback, setShowRollback] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterSof, setFilterSof] = useState('');
  const [selectedPositionTitle, setSelectedPositionTitle] = useState('');

  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    try {
      let url = `http://localhost:3000/travels/graph?type=${graphType}`;
      if (selectedEmployeeId) url += `&employee_ID=${selectedEmployeeId}`;
      if (filterYear) url += `&year=${filterYear}`;
      if (filterMonth) url += `&month=${filterMonth}`;
      if (selectedPositionTitle) url += `&positionTitle=${encodeURIComponent(selectedPositionTitle)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch graph data: ${response.statusText}`);
      const data = await response.json();
      setGraphData({
        labels: data.labels || [],
        datasets: data.datasets.length
          ? data.datasets
          : [{
              label: `Travel Entries by ${graphType}${filterYear ? ` in ${filterYear}` : ''}${filterMonth ? `, ${monthOptions.find(m => m.value === filterMonth).label}` : ''}${selectedEmployeeId ? ` for Employee ID ${selectedEmployeeId}` : ''} (Position: ${selectedPositionTitle || 'All'})`,
              data: [],
              fill: false,
              backgroundColor: 'rgba(75, 192, 192, 0.6)',
              borderColor: 'rgba(75, 192, 192, 1)',
              borderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 7,
            }],
      });
    } catch (err) {
      console.error('Graph data fetch error:', err);
      setError(err.message);
      setGraphData({ labels: [], datasets: [] });
    } finally {
      setLoading(false);
    }
  }, [graphType, selectedEmployeeId, filterYear, filterMonth, selectedPositionTitle]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [travelRes, empRes] = await Promise.all([
        fetch('http://localhost:3000/travels'),
        fetch('http://localhost:3000/employees'),
      ]);
      if (!travelRes.ok) throw new Error(`Failed to fetch travels: ${travelRes.statusText}`);
      if (!empRes.ok) throw new Error(`Failed to fetch employees: ${empRes.statusText}`);
      const [travelData, empData] = await Promise.all([travelRes.json(), empRes.json()]);
      setEntries(travelData);
      setEmployees(empData);
    } catch (err) {
      console.error('Data fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'attachment' && files && files[0]) {
      const file = files[0];
      if (file.type !== 'application/pdf') {
        setError('Please upload a PDF file only.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('File size exceeds 10MB limit.');
        return;
      }
      setForm((prev) => ({
        ...prev,
        attachment: file,
        attachmentPreview: URL.createObjectURL(file),
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSelectEmployee = (e) => {
    const employeeId = e.target.value;
    setSelectedEmployeeId(employeeId);
    const emp = employees.find((e) => e.uid === parseInt(employeeId));
    if (emp) {
      setForm((prev) => ({
        ...prev,
        employeeID: emp.uid || '',
        positiondesignation: emp.positionTitle || '',
        station: emp.office || '',
        sof: emp.sof || '',
        attachment: null,
        attachmentPreview: null,
      }));
    }
    fetchGraphData();
  };

  const handleGraphSearch = (e) => {
    const searchTerm = e.target.value.toLowerCase();
    setGraphSearch(searchTerm);
    const matchedEmployee = employees.find(
      (emp) =>
        emp.fullname.toLowerCase().includes(searchTerm) ||
        emp.uid.toString().includes(searchTerm)
    );
    setSelectedEmployeeId(matchedEmployee ? matchedEmployee.uid.toString() : '');
    fetchGraphData();
  };

  const handleYearFilter = (e) => {
    setFilterYear(e.target.value);
    fetchGraphData();
  };

  const handleMonthFilter = (e) => {
    setFilterMonth(e.target.value);
    fetchGraphData();
  };

  const handleSofFilter = (e) => {
    setFilterSof(e.target.value.toLowerCase());
  };

  const handlePositionTitleFilter = (e) => {
    setSelectedPositionTitle(e.target.value);
    fetchGraphData();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const requiredFields = ['positiondesignation', 'station', 'purpose', 'host', 'fromDate', 'toDate', 'destination', 'area', 'sof'];
    const missingFields = requiredFields.filter((field) => !form[field]);
    if (missingFields.length > 0) {
      setError(`Missing required fields: ${missingFields.join(', ')}`);
      setLoading(false);
      return;
    }

    const formData = new FormData();
    Object.entries({
      employeeID: form.employeeID,
      positiondesignation: form.positiondesignation,
      station: form.station,
      purpose: form.purpose,
      host: form.host,
      datesfrom: form.fromDate,
      datesto: form.toDate,
      destination: form.destination,
      area: form.area,
      sof: form.sof,
    }).forEach(([key, value]) => formData.append(key, value));
    if (form.attachment) formData.append('attachment', form.attachment);

    const method = editingId ? 'PUT' : 'POST';
    const url = editingId
      ? `http://localhost:3000/travels/${editingId}`
      : 'http://localhost:3000/travels';

    try {
      const res = await fetch(url, {
        method,
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to ${method === 'PUT' ? 'update' : 'save'} entry: ${res.statusText}`);
      }
      const data = await res.json();
      const updatedEntry = {
        ...form,
        id: editingId || data.id,
        DatesFrom: form.fromDate,
        DatesTo: form.toDate,
        sof: form.sof,
        Attachment: data.attachmentPath || null,
      };
      setEntries((prev) => (method === 'PUT' ? prev.map((e) => (e.id === editingId ? updatedEntry : e)) : [...prev, updatedEntry]));
      setForm(initialFormState);
      setEditingId(null);
      fetchGraphData();
      setNotification({ message: `Entry ${method === 'PUT' ? 'updated' : 'added'} successfully!`, type: 'success' });
    } catch (err) {
      console.error('Submission error:', err);
      setError(err.message);
      setNotification({ message: `Error: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => {
        setError(null);
        setNotification({ message: '', type: '' });
      }, 3000);
    }
  };

  const handleEdit = (entry) => {
    setForm({
      employeeID: entry.employee_ID || '',
      positiondesignation: entry.PositionDesignation || '',
      station: entry.Station || '',
      purpose: entry.Purpose || '',
      host: entry.Host || '',
      fromDate: entry.DatesFrom ? new Date(entry.DatesFrom).toISOString().split('T')[0] : '',
      toDate: entry.DatesTo ? new Date(entry.DatesTo).toISOString().split('T')[0] : '',
      destination: entry.Destination || '',
      area: entry.Area || '',
      sof: entry.sof || '',
      attachment: null,
      attachmentPreview: entry.Attachment ? `http://localhost:3000${entry.Attachment}` : null,
    });
    setEditingId(entry.id);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/travels/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete entry: ${res.statusText}`);
      const data = await res.json();
      setEntries((prev) => prev.filter((e) => e.id !== id));
      fetchGraphData();
      setNotification({ message: data.message || 'Entry deleted successfully!', type: 'success' });
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.message);
      setNotification({ message: `Error: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => {
        setError(null);
        setNotification({ message: '', type: '' });
      }, 3000);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      setError('No entries selected for deletion');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} entries?`)) return;
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/travels/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete entries: ${res.statusText}`);
      }
      const data = await res.json();
      setEntries((prev) => prev.filter((e) => !selectedIds.has(e.id)));
      setSelectedIds(new Set());
      fetchGraphData();
      setNotification({ message: data.message || 'Entries deleted successfully!', type: 'success' });
    } catch (err) {
      console.error('Bulk delete error:', err);
      setError(err.message);
      setNotification({ message: `Error: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => {
        setError(null);
        setNotification({ message: '', type: '' });
      }, 3000);
    }
  };

  const normalizeKey = (key) => key?.toLowerCase().trim();

  const handleExcel = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('Are you sure you want to upload this Excel file? This will overwrite existing data.')) {
      e.target.value = '';
      return;
    }

    setPreUploadEntries([...entries]);
    setShowRollback(false);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      setLoading(true);
      try {
        const workbook = XLSX.read(evt.target.result, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);

        const payload = data.map((row) => {
          const keys = Object.keys(row).reduce((acc, key) => {
            acc[normalizeKey(key)] = row[key];
            return acc;
          }, {});

          const entry = {
            employeeID: keys['employee_id'] || keys['employeeid'] || '',
            positiondesignation: keys['positiondesignation'] || '',
            station: keys['station'] || '',
            purpose: keys['purpose'] || '',
            host: keys['host'] || '',
            fromDate: keys['datesfrom'] || keys['datefrom'] || '',
            toDate: keys['datesto'] || keys['dateto'] || '',
            destination: keys['destination'] || '',
            area: keys['area'] || '',
            sof: keys['sof'] || keys['sourceoffunds'] || '',
          };

          const requiredFields = ['employeeID', 'positiondesignation', 'station', 'purpose', 'host', 'fromDate', 'toDate', 'destination', 'area', 'sof'];
          const missingFields = requiredFields.filter((field) => !entry[field] || entry[field] === '');
          if (missingFields.length > 0) {
            console.warn(`Skipping invalid entry due to missing fields: ${missingFields.join(', ')}`, entry);
            return null;
          }

          return entry;
        }).filter((entry) => entry !== null);

        if (payload.length === 0) throw new Error('No valid data found in Excel file');
        console.log('Sending payload:', JSON.stringify(payload, null, 2));
        const res = await fetch('http://localhost:3000/travels/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text();
          const errorData = await res.json().catch(() => ({ error: text }));
          console.error('Server response:', errorData);
          throw new Error(`Failed to upload Excel: ${res.statusText} - Details: ${JSON.stringify(errorData)}`);
        }
        const result = await res.json();
        setNotification({ message: result.message || 'Excel file uploaded successfully! Rollback available.', type: 'success' });
        await fetchData();
        await fetchGraphData();
        setShowRollback(true);
      } catch (err) {
        console.error('Excel upload error:', err);
        setNotification({ message: `Upload failed: ${err.message}. All uploaded data has been removed.`, type: 'error' });
        setError(err.message);
        setEntries(preUploadEntries);
        await fetchGraphData();
      } finally {
        setLoading(false);
        setTimeout(() => {
          setError(null);
          setNotification({ message: '', type: '' });
        }, 3000);
        e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleRollback = () => {
    if (window.confirm('Are you sure you want to rollback to the previous data?')) {
      setEntries(preUploadEntries);
      setNotification({ message: 'Data rolled back successfully! All uploaded data has been removed.', type: 'success' });
      fetchGraphData();
      setShowRollback(false);
      setTimeout(() => {
        setError(null);
        setNotification({ message: '', type: '' });
      }, 3000);
    }
  };

  const handleExportExcel = () => {
    const worksheetData = filteredEntries.map((entry) => ({
      Name: entry.Name || 'Unnamed',
      Position: entry.PositionDesignation || 'N/A',
      Initial: entry.Initial || 'N/A',
      Station: entry.Station || 'N/A',
      Purpose: entry.Purpose || 'N/A',
      Host: entry.Host || 'N/A',
      Dates: `${formatDate(entry.DatesFrom)} to ${formatDate(entry.DatesTo)}`,
      Destination: entry.Destination || 'N/A',
      Area: entry.Area || 'N/A',
      'Source of Funds': entry.sof || 'N/A',
      EmployeeID: entry.employee_ID || 'N/A',
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Travel Entries');
    const filename = `Travel_Entries_${currentDateTime.toLocaleDateString()}_${currentDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/:/g, '-')}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  const handlePrint = (entry) => {
    const printContent = createPrintTemplate(entry);
    const printWindow = window.open('', '', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    } else {
      setError('Popup blocked. Please allow popups for printing.');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleViewAttachment = (attachmentPath) => {
    if (attachmentPath) {
      window.open(`http://localhost:3000${attachmentPath}`, '_blank', 'noopener,noreferrer');
    } else {
      setError('No attachment available to view.');
      setTimeout(() => setError(null), 3000);
    }
  };

  const graphOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: {
        display: true,
        text: `Travel Entries by ${graphType}${filterYear ? ` in ${filterYear}` : ''}${filterMonth ? `, ${monthOptions.find(m => m.value === filterMonth).label}` : ''}${selectedEmployeeId ? ` for Employee ID ${selectedEmployeeId}` : ''} (Position: ${selectedPositionTitle || 'All'})`,
      },
    },
    scales: {
      x: { title: { display: true, text: graphType.charAt(0).toUpperCase() + graphType.slice(1) } },
      y: { beginAtZero: true, title: { display: true, text: 'Number of Entries' } },
    },
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      !search ||
      (entry.Name && entry.Name.toLowerCase().includes(search.toLowerCase())) ||
      (entry.sof && entry.sof.toLowerCase().includes(search.toLowerCase()));
    const matchesYear =
      !filterYear ||
      (entry.DatesFrom && new Date(entry.DatesFrom).getFullYear().toString() === filterYear);
    const matchesMonth =
      !filterMonth ||
      (entry.DatesFrom && new Date(entry.DatesFrom).getMonth() + 1 === parseInt(filterMonth));
    const matchesSof =
      !filterSof ||
      (entry.sof && entry.sof.toLowerCase().includes(filterSof));
    const matchesPosition =
      !selectedPositionTitle ||
      (entry.PositionDesignation && entry.PositionDesignation.toLowerCase().includes(selectedPositionTitle.toLowerCase()));
    return matchesSearch && matchesYear && matchesMonth && matchesSof && matchesPosition;
  });

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allIds = new Set(filteredEntries.map((entry) => entry.id));
    setSelectedIds(allIds);
  };

  useEffect(() => {
    fetchData();
    fetchGraphData();
  }, [fetchData, fetchGraphData]);

  return (
    <div className="travel-authority">
      <h1>Travel Authority Database</h1>

      <div className="controls">
        <input
          type="text"
          placeholder="Search by Name or Source of Funds..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <input
          type="text"
          placeholder="Search Graph by Employee..."
          value={graphSearch}
          onChange={handleGraphSearch}
          className="search-input graph-search"
        />
        <input
          type="file"
          onChange={handleExcel}
          className="excel-upload"
          accept=".xlsx,.xls"
        />
        <select
          value={selectedEmployeeId}
          onChange={handleSelectEmployee}
          className="employee-dropdown"
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.uid} value={emp.uid}>
              {emp.fullname} - {emp.Initial}
            </option>
          ))}
        </select>
        <select
          value={graphType}
          onChange={(e) => setGraphType(e.target.value)}
          className="graph-type-dropdown"
        >
          <option value="year">Year</option>
          <option value="month">Month</option>
          <option value="week">Week</option>
          <option value="date">Date</option>
        </select>
        <select
          value={filterYear}
          onChange={handleYearFilter}
          className="year-filter-dropdown"
          style={{ marginLeft: '10px' }}
        >
          <option value="">All Years</option>
          {[...new Set(entries.map((entry) => entry.DatesFrom && new Date(entry.DatesFrom).getFullYear()).filter(Boolean))].sort().map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={handleMonthFilter}
          className="month-filter-dropdown"
          style={{ marginLeft: '10px' }}
        >
          {monthOptions.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by Source of Funds..."
          value={filterSof}
          onChange={handleSofFilter}
          className="search-input sof-filter"
          style={{ marginLeft: '10px' }}
        />
        <select
          value={selectedPositionTitle}
          onChange={handlePositionTitleFilter}
          className="position-filter-dropdown"
          style={{ marginLeft: '10px' }}
        >
          <option value="">All Positions</option>
          {[...new Set(employees.map((emp) => emp.positionTitle).filter(Boolean))].sort().map((title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ))}
        </select>
        <button onClick={handleExportExcel} className="export-btn" style={{ marginLeft: '10px' }}>
          Export to Excel
        </button>
        {showRollback && (
          <button onClick={handleRollback} className="rollback-btn">
            Rollback
          </button>
        )}
        <button onClick={handleBulkDelete} disabled={loading || selectedIds.size === 0} className="bulk-delete-btn">
          {loading ? 'Processing...' : `Delete Selected (${selectedIds.size})`}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="travel-form" encType="multipart/form-data">
        <div className="form-row">
          <select
            name="employeeID"
            value={form.employeeID}
            onChange={handleChange}
            className="form-input large-text"
            required
          >
            <option value="">Select Employee</option>
            {employees.map((emp) => (
              <option key={emp.uid} value={emp.uid}>
                {emp.fullname} - {emp.Initial}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="positiondesignation"
            value={form.positiondesignation}
            onChange={handleChange}
            placeholder="Position/Designation"
            className="form-input large-text"
            required
          />
        </div>
        <div className="form-row">
          <input
            type="text"
            name="station"
            value={form.station}
            onChange={handleChange}
            placeholder="Station"
            className="form-input"
            required
          />
          <input
            type="text"
            name="purpose"
            value={form.purpose}
            onChange={handleChange}
            placeholder="Purpose"
            className="form-input"
            required
          />
        </div>
        <div className="form-row">
          <input
            type="text"
            name="host"
            value={form.host}
            onChange={handleChange}
            placeholder="Host"
            className="form-input"
            required
          />
          <input
            type="date"
            name="fromDate"
            value={form.fromDate}
            onChange={handleChange}
            className="form-input"
            required
          />
        </div>
        <div className="form-row">
          <input
            type="date"
            name="toDate"
            value={form.toDate}
            onChange={handleChange}
            className="form-input"
            required
          />
          <input
            type="text"
            name="destination"
            value={form.destination}
            onChange={handleChange}
            placeholder="Destination"
            className="form-input"
            required
          />
        </div>
        <div className="form-row">
          <input
            type="text"
            name="area"
            value={form.area}
            onChange={handleChange}
            placeholder="Area"
            className="form-input"
            required
          />
          <input
            type="text"
            name="sof"
            value={form.sof}
            onChange={handleChange}
            placeholder="Source of Funds"
            className="form-input"
            required
          />
        </div>
        <div className="form-row">
          <input
            type="file"
            name="attachment"
            onChange={handleChange}
            accept="application/pdf"
            className="form-input attachment-upload"
          />
          {form.attachmentPreview && (
            <a href={form.attachmentPreview} target="_blank" rel="noopener noreferrer" className="attachment-preview">
              Preview PDF
            </a>
          )}
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Processing...' : (editingId ? 'Update' : 'Add') + ' Entry'}
        </button>
      </form>

      {loading && <p className="loading">Loading... Please wait.</p>}
      {error && <p className="error">Error: {error}</p>}
      {notification.message && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      <div className="graph-container">
        <h2>Travel Entries Distribution</h2>
        {graphData.labels.length > 0 && graphData.datasets.length > 0 ? (
          <Line data={graphData} options={graphOptions} />
        ) : (
          <p className="no-data">No graph data available. Please check filters or data.</p>
        )}
      </div>

      <table className="travel-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                onChange={handleSelectAll}
                checked={filteredEntries.length > 0 && filteredEntries.every((entry) => selectedIds.has(entry.id))}
              />
            </th>
            <th>Name</th>
            <th>Position</th>
            <th>Station</th>
            <th>Purpose</th>
            <th>Host</th>
            <th>Dates</th>
            <th>Destination</th>
            <th>Area</th>
            <th>Source of Funds</th>
            <th>Employee ID</th>
            <th>Attachment</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.map((entry) => (
            <tr key={entry.id} className="travel-row">
              <td>
                <input
                  type="checkbox"
                  checked={selectedIds.has(entry.id)}
                  onChange={() => handleToggleSelect(entry.id)}
                />
              </td>
              <td>{entry.fullname || 'Unnamed'}</td>
              <td>{entry.PositionDesignation || 'N/A'}</td>
              <td>{entry.Station || 'N/A'}</td>
              <td>{entry.Purpose || 'N/A'}</td>
              <td>{entry.Host || 'N/A'}</td>
              <td>
                {formatDate(entry.DatesFrom)} to {formatDate(entry.DatesTo)}
              </td>
              <td>{entry.Destination || 'N/A'}</td>
              <td>{entry.Area || 'N/A'}</td>
              <td>{entry.sof || 'N/A'}</td>
              <td>{entry.employee_ID || 'N/A'}</td>
              <td>{entry.Attachment ? <a href={`http://localhost:3000${entry.Attachment}`} target="_blank" rel="noopener noreferrer">View PDF</a> : 'N/A'}</td>
              <td className="travel-actions">
                <button onClick={() => handleEdit(entry)} disabled={loading}>
                  Edit
                </button>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(entry.id)}
                  disabled={loading}
                >
                  Delete
                </button>
                <button
                  className="print-btn"
                  onClick={() => handlePrint(entry)}
                  disabled={loading}
                >
                  Print
                </button>
                {entry.Attachment && (
                  <button
                    className="view-attachment-btn"
                    onClick={() => handleViewAttachment(entry.Attachment)}
                    disabled={loading}
                  >
                    View Attachment
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TravelAuthority;