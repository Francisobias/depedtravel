import React, { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import './App.css';
import { useHistory } from 'react-router-dom'; // Changed from useNavigate

function App() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('');
  const history = useHistory(); // Changed from useNavigate

  const initialForm = {
    office: '',
    fullname: '',
    positionTitle: '',
    Initial: '',
  };

  const [form, setForm] = useState(initialForm);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3000/employees');
      const data = await res.json();
      setEmployees(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingId
        ? `http://localhost:3000/employees/${editingId}`
        : 'http://localhost:3000/employees';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (editingId) {
        setEmployees((prev) =>
          prev.map((emp) => (emp.uid === editingId ? { ...form, uid: editingId } : emp))
        );
      } else {
        setEmployees((prev) => [...prev, { ...form, uid: data.id || data.uid }]);
      }

      setForm(initialForm);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (emp) => {
    setForm(emp);
    setEditingId(emp.uid);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this employee?')) return;
    try {
      await fetch(`http://localhost:3000/employees/${id}`, { method: 'DELETE' });
      setEmployees((prev) => prev.filter((emp) => emp.uid !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const workbook = XLSX.read(evt.target.result, { type: 'binary' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(sheet);

      const employees = parsed
        .filter(row => row['Full Name'])
        .map(row => ({
          office: row['Office'] || '',
          fullname: row['Full Name'] || '',
          positionTitle: row['Position Title'] || '',
          Initial: row['Initial'] || '',
        }));

      try {
        const res = await fetch('http://localhost:3000/employees/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employees }),
        });

        const result = await res.json();
        alert(result.message);
        fetchEmployees();
      } catch (err) {
        console.error('Bulk upload error:', err.message);
      }
    };

    reader.readAsBinaryString(file);
  };

  const filteredEmployees = employees
    .filter(emp => {
      const safeFullname = emp.fullname?.toLowerCase() || '';
      const safeOffice = emp.office?.toLowerCase() || '';
      const safeInitial = emp.Initial?.toLowerCase() || '';
      const term = searchTerm.toLowerCase();
      return (
        safeFullname.includes(term) ||
        safeOffice.includes(term) ||
        safeInitial.includes(term)
      );
    })
    .sort((a, b) => {
      if (!sortField) return 0;
      return (a[sortField] || '').localeCompare(b[sortField] || '');
    });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div className="App">
      <h1>Employee Management</h1>

      <button onClick={() => history.push('/travel-authority')} className="travel-btn">
        Go to Travel Authority
      </button>

      <button onClick={() => history.push('/appointment')} className="travel-btn">
        Go to Appointment Management
      </button>

      {/* Upload Excel */}
      <label htmlFor="upload" className="upload-btn">Upload Excel</label>
      <input
        id="upload"
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* Search and Sort */}
      <div className="search-sort">
        <input
          type="text"
          placeholder="Search by name, office, initial..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select value={sortField} onChange={(e) => setSortField(e.target.value)}>
          <option value="">Sort by...</option>
          <option value="fullname">Name</option>
          <option value="office">Office</option>
          <option value="Initial">Initial</option>
        </select>
      </div>

      {/* Form */}
      <div className="form-wrapper">
        <h2>{editingId ? 'Edit Employee' : 'Add New Employee'}</h2>
        <form onSubmit={handleSubmit} className="employee-form">
          {Object.keys(initialForm).map((key) => (
            <input
              key={key}
              name={key}
              value={form[key]}
              onChange={handleInputChange}
              placeholder={key.replace(/([A-Z])/g, ' $1')}
              required
            />
          ))}
          <button type="submit">{editingId ? 'Update' : 'Add'} Employee</button>
          {editingId && (
            <button type="button" onClick={() => {
              setForm(initialForm);
              setEditingId(null);
            }}>
              Cancel
            </button>
          )}
        </form>
      </div>

      {/* No Employees Message */}
      {!employees.length && (
        <p className="no-data-msg">No employees found. Please upload or add new entries.</p>
      )}

      {/* Employee List */}
      <ul className="employee-list">
        {filteredEmployees.map((emp) => (
          <li className="employee-item" key={emp.uid}>
            <div className="employee-details">
              <p><strong>Office:</strong> {emp.office}</p>
              <p><strong>Name:</strong> {emp.fullname}</p>
              <p><strong>Position:</strong> {emp.positionTitle}</p>
              <p><strong>Initial:</strong> {emp.Initial}</p>
            </div>
            <div className="employee-actions">
              <button onClick={() => handleEdit(emp)}>Edit</button>
              <button className="delete-btn" onClick={() => handleDelete(emp.uid)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;