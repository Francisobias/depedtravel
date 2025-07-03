import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import './Appointment.css';

const initialFormState = {
  name: '',
  positionTitle: '',
  statusAppointment: 'Scheduled',
  schoolOffice: '',
  natureAppointment: '',
  itemNo: '',
  DateSigned: '',
};

function Appointment() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({ save: false, delete: {}, bulk: false, bulkDelete: false });
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ field: '', direction: 'asc' });
  const [form, setForm] = useState(initialFormState);
  const [pdfFile, setPdfFile] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [selectedAppointments, setSelectedAppointments] = useState(new Set());
  const formRef = useRef(null);

  const navigate = useNavigate();

  const validateForm = useCallback(() => {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    if (!form.positionTitle.trim()) errors.positionTitle = 'Position title is required';
    if (!form.statusAppointment) errors.statusAppointment = 'Status is required';
    if (!form.schoolOffice.trim()) errors.schoolOffice = 'School office is required';
    if (!form.DateSigned) errors.DateSigned = 'Date signed is required';
    return errors;
  }, [form]);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3000/appointments');
      if (!res.ok) throw new Error(`Failed to fetch appointments: ${res.statusText}`);
      const data = await res.json();
      setAppointments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setFormErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handlePdfChange = (e) => {
    const file = e.target.files?.[0];
    if (file && file.type !== 'application/pdf') {
      setError('Only PDF files are allowed');
      setPdfFile(null);
      e.target.value = '';
      return;
    }
    setPdfFile(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setActionLoading(prev => ({ ...prev, save: true }));
    setError(null);

    try {
      let appointmentId = editingId;
      const url = appointmentId
        ? `http://localhost:3000/appointments/${appointmentId}`
        : 'http://localhost:3000/appointments';
      const method = appointmentId ? 'PUT' : 'POST';

      const formattedForm = {
        ...form,
        DateSigned: new Date(form.DateSigned).toISOString().split('T')[0],
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedForm),
      });
      if (!res.ok) throw new Error(`Failed to ${editingId ? 'update' : 'save'} appointment: ${res.statusText}`);

      const savedData = await res.json();
      appointmentId = savedData.id || appointmentId;

      if (pdfFile) {
        const uploadForm = new FormData();
        uploadForm.append('attachment', pdfFile);
        const uploadRes = await fetch(`http://localhost:3000/appointments/${appointmentId}/attachment`, {
          method: 'POST',
          body: uploadForm,
        });
        if (!uploadRes.ok) throw new Error(`Failed to upload PDF: ${uploadRes.statusText}`);
      }

      fetchAppointments();
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, save: false }));
    }
  };

  const resetForm = () => {
    setForm(initialFormState);
    setEditingId(null);
    setPdfFile(null);
    setFormErrors({});
    if (formRef.current) formRef.current.reset();
  };

  const handleEdit = (appointment) => {
    setForm({
      ...appointment,
      DateSigned: appointment.DateSigned ? new Date(appointment.DateSigned).toISOString().split('T')[0] : '',
    });
    setEditingId(appointment.id);
    setPdfFile(null);
    setFormErrors({});
  };

  const handleDelete = async (id) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: 'This action will permanently delete the appointment!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete it!',
      cancelButtonText: 'No, cancel',
    });
    if (result.isConfirmed) {
      setActionLoading(prev => ({ ...prev, delete: { ...prev.delete, [id]: true } }));
      setError(null);
      try {
        const res = await fetch(`http://localhost:3000/appointments/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`Failed to delete appointment: ${res.statusText}`);
        setAppointments(prev => prev.filter(app => app.id !== id));
        setSelectedAppointments(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setActionLoading(prev => ({ ...prev, delete: { ...prev.delete, [id]: false } }));
      }
    }
  };

  const handleBulkDelete = async () => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: `This will permanently delete ${selectedAppointments.size} appointment(s)!`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete them!',
      cancelButtonText: 'No, cancel',
    });
    if (result.isConfirmed) {
      setActionLoading(prev => ({ ...prev, bulkDelete: true }));
      setError(null);

      try {
        const res = await fetch('http://localhost:3000/appointments/bulk-delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(selectedAppointments) }),
        });
        if (!res.ok) throw new Error(`Failed to delete selected appointments: ${res.statusText}`);
        fetchAppointments();
        setSelectedAppointments(new Set());
      } catch (err) {
        setError(err.message);
      } finally {
        setActionLoading(prev => ({ ...prev, bulkDelete: false }));
      }
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/)) {
      setError('Only Excel files (.xlsx, .xls) are allowed');
      e.target.value = '';
      return;
    }

    setActionLoading(prev => ({ ...prev, bulk: true }));
    setError(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = XLSX.utils.sheet_to_json(sheet);

        const appointmentsData = parsed
          .filter(row => row['name'])
          .map(row => ({
            name: row['name']?.toString() || '',
            positionTitle: row['positionTitle']?.toString() || '',
            statusAppointment: row['statusAppointment']?.toString() || 'Scheduled',
            schoolOffice: row['schoolOffice']?.toString() || '',
            natureAppointment: row['natureAppointment']?.toString() || '',
            itemNo: row['itemNo']?.toString() || '',
            DateSigned: row['DateSigned']
              ? new Date(row['DateSigned']).toISOString().split('T')[0]
              : '',
          }))
          .filter(row => row.name && row.positionTitle && row.statusAppointment && row.schoolOffice && row.DateSigned);

        if (!appointmentsData.length) {
          throw new Error('No valid data found in Excel file');
        }

        const res = await fetch('http://localhost:3000/appointments/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointments: appointmentsData }),
        });
        if (!res.ok) throw new Error(`Bulk upload failed: ${res.statusText}`);
        const result = await res.json();
        alert(result.message);
        fetchAppointments();
      } catch (err) {
        setError(err.message);
      } finally {
        setActionLoading(prev => ({ ...prev, bulk: false }));
        e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSort = (field) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedAppointments(new Set(filteredAppointments.map(app => app.id)));
    } else {
      setSelectedAppointments(new Set());
    }
  };

  const handleSelectAppointment = (id) => {
    setSelectedAppointments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const filteredAppointments = appointments
    .filter(app => {
      const term = searchTerm.toLowerCase();
      return (
        app.name?.toLowerCase().includes(term) ||
        app.positionTitle?.toLowerCase().includes(term) ||
        app.statusAppointment?.toLowerCase().includes(term) ||
        app.schoolOffice?.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      if (!sortConfig.field) return 0;
      const aValue = (a[sortConfig.field] || '').toString().toLowerCase();
      const bValue = (b[sortConfig.field] || '').toString().toLowerCase();
      return sortConfig.direction === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    });

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Appointment Management</h1>
      </header>
      <main className="app-main">
        {loading && <div className="loading-overlay">Loading...</div>}
        {error && <div className="error-message">{error}</div>}

        <div className="controls-section">
          <div className="control-group">
            <label htmlFor="upload" className={`upload-button ${actionLoading.bulk ? 'disabled' : ''}`}>
              {actionLoading.bulk ? 'Uploading...' : 'Upload Excel'}
            </label>
            <input
              id="upload"
              type="file"
              accept=".xlsx,.xls"
              className="file-input"
              onChange={handleFileUpload}
              disabled={actionLoading.bulk}
            />
            <button
              onClick={() => navigate('/employee-management')}
              className="nav-button"
            >
              Employee Management
            </button>
            <button
              onClick={handleBulkDelete}
              className={`delete-selected-button ${actionLoading.bulkDelete || selectedAppointments.size === 0 ? 'disabled' : ''}`}
              disabled={actionLoading.bulkDelete || selectedAppointments.size === 0}
            >
              {actionLoading.bulkDelete ? 'Deleting...' : `Delete Selected (${selectedAppointments.size})`}
            </button>
          </div>
          <div className="control-group">
            <input
              type="text"
              placeholder="Search appointments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={sortConfig.field}
              onChange={(e) => handleSort(e.target.value)}
              className="sort-select"
            >
              <option value="">Sort by...</option>
              <option value="name">Name</option>
              <option value="positionTitle">Position</option>
              <option value="statusAppointment">Status</option>
              <option value="schoolOffice">School Office</option>
            </select>
          </div>
        </div>

        <div className="form-card">
          <form ref={formRef} onSubmit={handleSubmit} className="appointment-form">
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={handleInputChange}
                  className={`form-input ${formErrors.name ? 'error' : ''}`}
                />
                {formErrors.name && <span className="error-text">{formErrors.name}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="positionTitle">Position Title</label>
                <input
                  id="positionTitle"
                  name="positionTitle"
                  value={form.positionTitle}
                  onChange={handleInputChange}
                  className={`form-input ${formErrors.positionTitle ? 'error' : ''}`}
                />
                {formErrors.positionTitle && <span className="error-text">{formErrors.positionTitle}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="statusAppointment">Status</label>
                <select
                  id="statusAppointment"
                  name="statusAppointment"
                  value={form.statusAppointment}
                  onChange={handleInputChange}
                  className={`form-input ${formErrors.statusAppointment ? 'error' : ''}`}
                >
                  <option value="Scheduled">Scheduled</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Completed">Completed</option>
                </select>
                {formErrors.statusAppointment && <span className="error-text">{formErrors.statusAppointment}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="schoolOffice">School Office</label>
                <input
                  id="schoolOffice"
                  name="schoolOffice"
                  value={form.schoolOffice}
                  onChange={handleInputChange}
                  className={`form-input ${formErrors.schoolOffice ? 'error' : ''}`}
                />
                {formErrors.schoolOffice && <span className="error-text">{formErrors.schoolOffice}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="natureAppointment">Nature of Appointment</label>
                <input
                  id="natureAppointment"
                  name="natureAppointment"
                  value={form.natureAppointment}
                  onChange={handleInputChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="itemNo">Item No.</label>
                <input
                  id="itemNo"
                  name="itemNo"
                  value={form.itemNo}
                  onChange={handleInputChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="DateSigned">Date Signed</label>
                <input
                  id="DateSigned"
                  type="date"
                  name="DateSigned"
                  value={form.DateSigned}
                  onChange={handleInputChange}
                  className={`form-input ${formErrors.DateSigned ? 'error' : ''}`}
                />
                {formErrors.DateSigned && <span className="error-text">{formErrors.DateSigned}</span>}
              </div>
              <div className="form-group full-width">
                <label htmlFor="pdf-upload">Attachment (PDF)</label>
                <input
                  id="pdf-upload"
                  type="file"
                  accept="application/pdf"
                  onChange={handlePdfChange}
                  className="file-input"
                />
                {pdfFile && <span className="success-text">Selected: {pdfFile.name}</span>}
              </div>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className={`submit-button ${actionLoading.save ? 'disabled' : ''}`}
                disabled={actionLoading.save}
              >
                {actionLoading.save ? 'Saving...' : editingId ? 'Update' : 'Add'} Appointment
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="cancel-button"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="table-card">
          {filteredAppointments.length === 0 ? (
            <div className="no-data">No appointments available. Add or upload one above.</div>
          ) : (
            <table className="appointments-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={filteredAppointments.length > 0 && selectedAppointments.size === filteredAppointments.length}
                    />
                  </th>
                  {['Name', 'Position', 'Status', 'School Office', 'Nature', 'Item No', 'Date Signed', 'PDF', 'Actions'].map(
                    (header) => (
                      <th
                        key={header}
                        className={header !== 'Actions' ? 'sortable' : ''}
                        onClick={() =>
                          header !== 'Actions' && handleSort(header.toLowerCase().replace(' ', ''))
                        }
                      >
                        {header}
                        {sortConfig.field === header.toLowerCase().replace(' ', '') && (
                          <span>{sortConfig.direction === 'asc' ? ' ↑' : ' ↓'}</span>
                        )}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedAppointments.has(app.id)}
                        onChange={() => handleSelectAppointment(app.id)}
                        disabled={actionLoading.delete[app.id]}
                      />
                    </td>
                    <td>{app.name}</td>
                    <td>{app.positionTitle}</td>
                    <td>{app.statusAppointment}</td>
                    <td>{app.schoolOffice}</td>
                    <td>{app.natureAppointment}</td>
                    <td>{app.itemNo}</td>
                    <td>{app.DateSigned ? new Date(app.DateSigned).toLocaleDateString() : ''}</td>
                    <td>
                      {app.pdfPath ? (
                        <a
                          href={`http://localhost:3000${app.pdfPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View PDF
                        </a>
                      ) : (
                        'No File'
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(app)}
                        className="action-button edit"
                        disabled={actionLoading.delete[app.id]}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(app.id)}
                        className={`action-button delete ${actionLoading.delete[app.id] ? 'disabled' : ''}`}
                        disabled={actionLoading.delete[app.id]}
                      >
                        {actionLoading.delete[app.id] ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

export default Appointment;