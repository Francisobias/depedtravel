import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './404-Page-3.css';

function PageNotFound() {
  const history = useHistory(); // Changed from useNavigate
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isAnimated, setIsAnimated] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update time every minute
    return () => clearInterval(timer);
  }, []);

  const toggleAnimation = () => {
    setIsAnimated((prev) => !prev);
  };

  return (
    <div className="not-found-container" role="main">
      <div className="not-found-content" aria-live="polite">
        <h1 className="not-found-title">
          4<span className={`glitch ${isAnimated ? '' : 'paused'}`}>0</span>4
        </h1>
        <p className="not-found-message">
          Error: Page not found. Let’s fix that as of{' '}
          {currentTime.toLocaleString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles',
          })}{' '}
          PST on {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
        </p>
        <div className="button-group">
          <button
            className="back-button"
            onClick={() => history.push('/')} // Changed from navigate('/')
            aria-label="Return to home page"
          >
            Return Home
          </button>
          <button
            className="back-button secondary"
            onClick={() => history.goBack()} // Changed from navigate(-1)
            aria-label="Go back to previous page"
          >
            Go Back
          </button>
          <button
            className="toggle-button"
            onClick={toggleAnimation}
            aria-label="Toggle animation"
          >
            {isAnimated ? 'Pause Animation' : 'Resume Animation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PageNotFound;