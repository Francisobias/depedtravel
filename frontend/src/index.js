import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import TravelAuthority from './components/TravelAuthority';
import Appointment from './components/Appointment';
import PageNotFound from './404-Page-3';
import { BrowserRouter, Switch, Route } from 'react-router-dom';

ReactDOM.render(
  <BrowserRouter>
    <Switch>
      <Route exact path="/" component={App} />
      <Route path="/travel-authority" component={TravelAuthority} />
      <Route path="/appointment" component={Appointment} />
      <Route component={PageNotFound} />
    </Switch>
  </BrowserRouter>,
  document.getElementById('root')
);