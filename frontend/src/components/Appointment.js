import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useHistory } from 'react-router-dom';
import Swal from 'sweetalert2';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import './Appointment.css';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const initialFormState = {
  name: '',
  positionTitle: '',
  statusAppointment: 'Scheduled',
  schoolOffice: '',
  natureAppointment: '',
  itemNo: '',
  DateSigned: '',
};

const ChatbotModal = ({ appointments, isOpen, onClose }) => {
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: 'Hi! I’m Grok, your Appointment Assistant. How can I help you today?',
      options: [
        { label: 'How to add an appointment?', value: 'add' },
        { label: 'How to search appointments?', value: 'search' },
        { label: 'How to upload Excel?', value: 'upload' },
        { label: 'How to delete appointments?', value: 'delete' },
        { label: 'Show recent appointments', value: 'recent' },
        { label: 'View appointment stats', value: 'stats' },
      ],
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [conversationContext, setConversationContext] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState(false);
  const [speechSynthesisSupported, setSpeechSynthesisSupported] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  // Initialize Web Speech API
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechRecognitionSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        setInputText(transcript);
      };

      recognitionRef.current.onerror = (event) => {
        setChatError(`Speech recognition error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    if ('speechSynthesis' in window) {
      setSpeechSynthesisSupported(true);
    }
  }, []);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Speak the latest bot message
  useEffect(() => {
    if (speechSynthesisSupported && messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      if (latestMessage.sender === 'bot' && !isSpeaking) {
        speakMessage(latestMessage.text);
      }
    }
  }, [messages, speechSynthesisSupported]);

  const speakMessage = (text) => {
    if (speechSynthesisSupported && !isSpeaking) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.volume = 1;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleOptionClick = async (value) => {
    setChatLoading(true);
    setChatError(null);

    const userMessage = { sender: 'user', text: value, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    setConversationContext(value);

    try {
      const recentAppointments = (appointments || [])
        .sort(( Penn, b) => new Date(b.DateSigned) - new Date(Penn.DateSigned))
        .slice(0, 3)
        .map(app => ({
          name: app.name || '',
          positionTitle: app.positionTitle || '',
          statusAppointment: app.statusAppointment || '',
          schoolOffice: app.schoolOffice || '',
          DateSigned: app.DateSigned ? new Date(app.DateSigned).toLocaleDateString() : '',
        }));

      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
      let response;
      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: value, appointments, context: conversationContext }),
        });

        if (!res.ok) throw new Error(`Backend request failed: ${res.statusText}`);
        const data = await res.json();
        response = data.response || 'Sorry, I couldn’t process that. Try asking about app features!';
      } catch (err) {
        console.warn('Falling back to mock response:', err.message);
        switch (value) {
          case 'add':
            response = 'To add an appointment, fill out the form with details like name, position title, status (Scheduled, Confirmed, or Completed), school office, and date signed. Click "Add Appointment" to save. Want tips on filling out the form?';
            break;
          case 'search':
            response = 'Type in the search bar above the table to filter appointments by name, position, status, office, nature, item number, or date. Results update instantly. Need help with specific search terms?';
            break;
          case 'upload':
            response = 'Click "Upload Excel" and select an Excel file (.xlsx or .xls). Ensure it has columns: name, positionTitle, statusAppointment, schoolOffice, and DateSigned. Missing fields will be skipped. Want a sample Excel template?';
            break;
          case 'delete':
            response = 'Select appointments using the checkboxes and click "Delete Selected" for bulk deletion, or click "Delete" next to an appointment. Confirm the action when prompted. Need to recover deleted appointments?';
            break;
          case 'recent':
            response = recentAppointments.length > 0
              ? `Recent appointments:\n${recentAppointments.map(app => `- ${app.name} (${app.positionTitle}, ${app.DateSigned})`).join('\n')}. Want details on any of these?`
              : 'No recent appointments found. Try adding one!';
            break;
          case 'stats':
            response = `You have ${appointments.length} total appointments. Breakdown by status: ${
              appointments.reduce((acc, app) => ({
                ...acc,
                [app.statusAppointment]: (acc[app.statusAppointment] || 0) + 1,
              }), {})
              ? Object.entries(
                  appointments.reduce((acc, app) => ({
                    ...acc,
                    [app.statusAppointment]: (acc[app.statusAppointment] || 0) + 1,
                  }), {})
                )
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(', ')
              : 'No data'
            }. Want to see the chart?`;
            break;
          case 'back':
            response = 'Back to main options. How can I assist you now?';
            break;
          default:
            response = 'I can help with adding, searching, uploading, deleting, or viewing appointment stats. Try the options below or ask a specific question.';
        }
      }

      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: response,
          options: value === 'recent' || value === 'stats'
            ? [{ label: 'Back to main options', value: 'back' }]
            : [
                { label: 'Back to main options', value: 'back' },
                { label: 'Ask another question', value: 'continue' },
              ],
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setChatError(`Failed to get response: ${err.message}`);
      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: 'Oops, something went wrong. Try the options below or type a question.',
          options: [
            { label: 'How to add an appointment?', value: 'add' },
            { label: 'How to search appointments?', value: 'search' },
            { label: 'How to upload Excel?', value: 'upload' },
            { label: 'How to delete appointments?', value: 'delete' },
            { label: 'Show recent appointments', value: 'recent' },
            { label: 'View appointment stats', value: 'stats' },
          ],
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMessage = inputText.trim();
    setMessages(prev => [...prev, { sender: 'user', text: userMessage, timestamp: new Date().toISOString() }]);
    setInputText('');
    setChatLoading(true);
    setChatError(null);

    try {
      const recentAppointments = (appointments || [])
        .sort((a, b) => new Date(b.DateSigned) - new Date(a.DateSigned))
        .slice(0, 3)
        .map(app => ({
          name: app.name || '',
          positionTitle: app.positionTitle || '',
          statusAppointment: app.statusAppointment || '',
          schoolOffice: app.schoolOffice || '',
          DateSigned: app.DateSigned ? new Date(app.DateSigned).toLocaleDateString() : '',
        }));

      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
      let response;
      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMessage, appointments, context: conversationContext }),
        });
        if (!res.ok) throw new Error(`Backend request failed: ${res.statusText}`);
        const data = await res.json();
        response = data.response || 'Sorry, I couldn’t process that. Try asking about app features!';
      } catch (err) {
        console.warn('Falling back to mock response:', err.message);
        const userMessageLower = userMessage.toLowerCase();
        if (userMessageLower.includes('add') || userMessageLower.includes('create')) {
          response = conversationContext === 'add'
            ? 'For adding appointments, ensure all required fields (name, position title, status, school office, date signed) are filled. You can also attach a PDF. Need a specific field explained?'
            : 'To add an appointment, fill out the form at the top with name, position, status, school office, and date signed. Click "Add Appointment" to save. Want tips on filling out the form?';
          setConversationContext('add');
        } else if (userMessageLower.includes('search') || userMessageLower.includes('find')) {
          response = conversationContext === 'search'
            ? 'Try specific terms like "John Doe" or "Scheduled" in the search bar. You can also sort by clicking column headers. Want to search for a specific appointment?'
            : 'Use the search bar above the table to filter by name, position, status, office, nature, item number, or date. Results update instantly. Need help with specific search terms?';
          setConversationContext('search');
        } else if (userMessageLower.includes('upload') || userMessageLower.includes('excel')) {
          response = conversationContext === 'upload'
            ? 'Ensure your Excel file has columns named exactly: name, positionTitle, statusAppointment, schoolOffice, DateSigned. Want a sample Excel template?'
            : 'Click "Upload Excel" and select an Excel file (.xlsx or .xls). Ensure it has columns: name, positionTitle, statusAppointment, schoolOffice, and DateSigned. Missing fields will be skipped.';
          setConversationContext('upload');
        } else if (userMessageLower.includes('delete') || userMessageLower.includes('remove')) {
          response = conversationContext === 'delete'
            ? 'You can’t recover deleted appointments, so double-check before confirming. Want to know how to select multiple appointments?'
            : 'Select appointments using checkboxes and click "Delete Selected" for bulk deletion, or click "Delete" next to an appointment. Confirm when prompted.';
          setConversationContext('delete');
        } else if (userMessageLower.includes('recent') || userMessageLower.includes('latest')) {
          response = recentAppointments.length > 0
            ? `Recent appointments:\n${recentAppointments.map(app => `- ${app.name} (${app.positionTitle}, ${app.DateSigned})`).join('\n')}. Want details on any of these?`
            : 'No recent appointments found. Try adding one!';
          setConversationContext('recent');
        } else if (userMessageLower.includes('stats') || userMessageLower.includes('statistics')) {
          response = `You have ${appointments.length} total appointments. Breakdown by status: ${
            appointments.reduce((acc, app) => ({
              ...acc,
              [app.statusAppointment]: (acc[app.statusAppointment] || 0) + 1,
            }), {})
            ? Object.entries(
                appointments.reduce((acc, app) => ({
                  ...acc,
                  [app.statusAppointment]: (acc[app.statusAppointment] || 0) + 1,
                  }), {})
                )
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(', ')
              : 'No data'
            }. Want to see the chart?`;
          setConversationContext('stats');
        } else if (userMessageLower.includes('template') && conversationContext === 'upload') {
          response = 'A sample Excel template should have columns: name (text), positionTitle (text), statusAppointment (Scheduled/Confirmed/Completed), schoolOffice (text), DateSigned (date, e.g., YYYY-MM-DD). Want to know how to create one?';
          setConversationContext('upload');
        } else if (userMessageLower.includes('recover') && conversationContext === 'delete') {
          response = 'Unfortunately, deleted appointments cannot be recovered in this system. Always confirm before deleting. Need help with anything else?';
          setConversationContext('delete');
        } else {
          response = 'I can assist with adding, searching, uploading, deleting, or viewing appointment stats. Try the options below or ask something specific!';
          setConversationContext(null);
        }
      }

      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: response,
          options: [
            { label: 'Back to main options', value: 'back' },
            { label: 'Ask another question', value: 'continue' },
          ],
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setChatError(`Failed to get response: ${err.message}`);
      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: 'Oops, something went wrong. Try the options below or type a question.',
          options: [
            { label: 'How to add an appointment?', value: 'add' },
            { label: 'How to search appointments?', value: 'search' },
            { label: 'How to upload Excel?', value: 'upload' },
            { label: 'How to delete appointments?', value: 'delete' },
            { label: 'Show recent appointments', value: 'recent' },
            { label: 'View appointment stats', value: 'stats' },
          ],
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleVoiceInput = () => {
    if (!speechRecognitionSupported) {
      setChatError('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      setChatError(null);
      recognitionRef.current.start();
    }
  };

  const handleStopSpeaking = () => {
    if (speechSynthesisSupported && isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const formatTimestamp = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Los_Angeles',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="chatbot-modal-overlay" role="dialog" aria-labelledby="chatbot-title">
      <div className="chatbot-modal">
        <div className="chatbot-header">
          <span id="chatbot-title">Appointment Assistant</span>
          <button
            className="chatbot-close"
            onClick={onClose}
            aria-label="Close chatbot"
          >
            ✕
          </button>
        </div>
        <div className="chatbot-messages">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`chatbot-message ${msg.sender}`}
              aria-live={msg.sender === 'bot' ? 'polite' : 'off'}
            >
              <div className="message-content">
                <span className="message-text">{msg.sender === 'user' ? msg.text.charAt(0).toUpperCase() + msg.text.slice(1) : msg.text}</span>
                <span className="message-timestamp">{formatTimestamp(msg.timestamp)}</span>
              </div>
              {msg.options && (
                <div className="chatbot-options">
                  {msg.options.map((opt, i) => (
                    <button
                      key={i}
                      className="chatbot-option"
                      onClick={() => handleOptionClick(opt.value)}
                      disabled={chatLoading}
                      aria-label={opt.label}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="chatbot-loading" aria-live="polite">
              <span className="typing-indicator">Typing...</span>
            </div>
          )}
          {chatError && (
            <div className="chatbot-error" aria-live="polite">
              {chatError}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSendMessage} className="chatbot-input-form">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type or speak your question (e.g., 'How to add an appointment?')"
            className="chatbot-input"
            disabled={chatLoading}
            aria-label="Chatbot input"
          />
          <button
            type="button"
            className={`chatbot-voice-button ${isListening ? 'active' : ''} ${!speechRecognitionSupported ? 'disabled' : ''}`}
            onClick={handleVoiceInput}
            disabled={chatLoading || !speechRecognitionSupported}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          >
            {isListening ? '🎙️ Stop' : '🎙️ Speak'}
          </button>
          <button
            type="submit"
            className={`chatbot-send-button ${chatLoading ? 'disabled' : ''}`}
            disabled={chatLoading}
            aria-label="Send message"
          >
            Send
          </button>
          {speechSynthesisSupported && (
            <button
              type="button"
              className={`chatbot-stop-speak-button ${isSpeaking ? '' : 'disabled'}`}
              onClick={handleStopSpeaking}
              disabled={!isSpeaking}
              aria-label="Stop speaking"
            >
              🛑 Stop Speaking
            </button>
          )}
        </form>
      </div>
    </div>
  );
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
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });
  const [chartLoading, setChartLoading] = useState(true);
  const [showChatbot, setShowChatbot] = useState(false);
  const formRef = useRef(null);
  const history = useHistory();

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

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
      const res = await fetch(`${API_URL}/appointments`);
      if (!res.ok) throw new Error(`Failed to fetch appointments: ${res.statusText}`);
      const data = await res.json();
      setAppointments(data);
    } catch (err) {
      setError(`Failed to load appointments: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  const fetchChartData = useCallback(async () => {
    setChartLoading(true);
    try {
      const res = await fetch(`${API_URL}/appointments/graph?type=year`);
      if (!res.ok) throw new Error(`Failed to fetch chart data: ${res.statusText}`);
      const data = await res.json();
      setChartData(data || {
        labels: [],
        datasets: [{
          label: 'Appointments by Year',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
        }],
      });
    } catch (err) {
      setError(`Failed to load chart data: ${err.message}`);
      setChartData({
        labels: [],
        datasets: [{
          label: 'Appointments by Year',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
        }],
      });
    } finally {
      setChartLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchAppointments();
    fetchChartData();
  }, [fetchAppointments, fetchChartData]);

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
        ? `${API_URL}/appointments/${appointmentId}`
        : `${API_URL}/appointments`;
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
        const uploadRes = await fetch(`${API_URL}/appointments/${appointmentId}/attachment`, {
          method: 'POST',
          body: uploadForm,
        });
        if (!uploadRes.ok) throw new Error(`Failed to upload PDF: ${uploadRes.statusText}`);
      }

      await fetchAppointments();
      await fetchChartData();
      resetForm();
      Swal.fire({
        title: 'Success!',
        text: `${editingId ? 'Updated' : 'Added'} appointment successfully!`,
        icon: 'success',
        confirmButtonColor: '#10b981',
      });
    } catch (err) {
      setError(err.message);
      Swal.fire({
        title: 'Error',
        text: err.message,
        icon: 'error',
        confirmButtonColor: '#10b981',
      });
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
        const res = await fetch(`${API_URL}/appointments/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`Failed to delete appointment: ${res.statusText}`);
        setAppointments(prev => prev.filter(app => app.id !== id));
        setSelectedAppointments(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
        await fetchChartData();
        Swal.fire({
          title: 'Success!',
          text: 'Appointment deleted successfully!',
          icon: 'success',
          confirmButtonColor: '#10b981',
        });
      } catch (err) {
        setError(err.message);
        Swal.fire({
          title: 'Error',
          text: err.message,
          icon: 'error',
          confirmButtonColor: '#10b981',
        });
      } finally {
        setActionLoading(prev => ({ ...prev, delete: { ...prev.delete, [id]: false } }));
      }
    }
  };

  const handleBulkDelete = async () => {
    if (selectedAppointments.size === 0) {
      Swal.fire({
        title: 'Error',
        text: 'Please select at least one appointment.',
        icon: 'error',
        confirmButtonColor: '#10b981',
      });
      return;
    }

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
        const payload = { ids: Array.from(selectedAppointments) };
        const res = await fetch(`${API_URL}/appointments/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Failed to delete appointments: ${res.statusText}`);
        }

        const data = await res.json();
        await fetchAppointments();
        setSelectedAppointments(new Set());
        await fetchChartData();
        Swal.fire({
          title: 'Success!',
          text: data.message,
          icon: 'success',
          confirmButtonColor: '#10b981',
        });
      } catch (err) {
        Swal.fire({
          title: 'Error',
          text: `Bulk delete failed: ${err.message}`,
          icon: 'error',
          confirmButtonColor: '#10b981',
        });
      } finally {
        setActionLoading(prev => ({ ...prev, bulkDelete: false }));
      }
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/)) {
      Swal.fire({
        title: 'Error',
        text: 'Only Excel files (.xlsx, .xls) are allowed',
        icon: 'error',
        confirmButtonColor: '#10b981',
      });
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
          .map(row => {
            const appointment = {
              name: row['name']?.toString() || '',
              positionTitle: row['positionTitle']?.toString() || '',
              statusAppointment: row['statusAppointment']?.toString() || 'Scheduled',
              schoolOffice: row['schoolOffice']?.toString() || '',
              natureAppointment: row['natureAppointment']?.toString() || '',
              itemNo: row['itemNo']?.toString() || '',
              DateSigned: row['DateSigned']
                ? new Date(row['DateSigned']).toISOString().split('T')[0]
                : '',
            };
            if (!appointment.name || !appointment.positionTitle || !appointment.statusAppointment || !appointment.schoolOffice || !appointment.DateSigned) {
              console.warn('Skipping row due to missing required fields:', row);
              return null;
            }
            return appointment;
          })
          .filter(appointment => appointment !== null);

        if (appointmentsData.length === 0) {
          throw new Error('No valid data found in Excel file. Ensure required fields (Name, Position Title, Status, School Office, Date Signed) are present.');
        }

        const res = await fetch(`${API_URL}/appointments/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointments: appointmentsData }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Failed to upload: ${res.statusText}`);
        }

        await fetchAppointments();
        await fetchChartData();
        Swal.fire({
          title: 'Success!',
          text: `${appointmentsData.length} appointment(s) uploaded successfully!`,
          icon: 'success',
          confirmButtonColor: '#10b981',
        });
      } catch (err) {
        Swal.fire({
          title: 'Error',
          text: `Bulk upload failed: ${err.message}`,
          icon: 'error',
          confirmButtonColor: '#10b981',
        });
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

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Number of Appointments' },
      },
      x: {
        title: { display: true, text: 'Year' },
      },
    },
  };

  const filteredAppointments = (appointments || [])
    .filter(app => {
      const term = searchTerm.toLowerCase();
      const date = app.DateSigned ? new Date(app.DateSigned).toLocaleDateString() : '';
      return (
        app.name?.toLowerCase().includes(term) ||
        app.positionTitle?.toLowerCase().includes(term) ||
        app.statusAppointment?.toLowerCase().includes(term) ||
        app.schoolOffice?.toLowerCase().includes(term) ||
        app.natureAppointment?.toLowerCase().includes(term) ||
        app.itemNo?.toLowerCase().includes(term) ||
        date.includes(term)
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
              onClick={() => history.push('/')}
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
              placeholder="Search appointments (name, position, status, office, nature, item, date)..."
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
                <button
                  type="button"
                  className="pdf-upload-button"
                  onClick={() => document.getElementById('pdf-upload').click()}
                >
                  {pdfFile ? `Replace PDF: ${pdfFile.name}` : 'Attach PDF'}
                </button>
                <input
                  id="pdf-upload"
                  type="file"
                  accept="application/pdf"
                  onChange={handlePdfChange}
                  className="file-input hidden"
                  style={{ display: 'none' }}
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
            <div className="table-container">
              <table className="appointments-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        onChange={handleSelectAll}
                        checked={filteredAppointments.length > 0 && filteredAppointments.every(app => selectedAppointments.has(app.id))}
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
                            href={`${API_URL}${app.pdfPath}`}
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
            </div>
          )}
        </div>
        <div className="chart-container" style={{ height: '300px', width: '600px' }}>
          {chartLoading ? <div>Loading chart...</div> : <Bar data={chartData} options={chartOptions} />}
        </div>

        <button
          className="chatbot-toggle"
          onClick={() => setShowChatbot(!showChatbot)}
        >
          {showChatbot ? 'Hide Chat' : 'Chat'}
        </button>
        <ChatbotModal
          appointments={appointments}
          isOpen={showChatbot}
          onClose={() => setShowChatbot(false)}
        />
      </main>
    </div>
  );
}

export default Appointment;