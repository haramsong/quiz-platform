import { useState } from 'react';
import LoginView from './LoginView';
import CodesPage from './CodesPage';
import './App.css';

const STORAGE_KEY = 'qp_master_key';

export default function App() {
  const [masterKey, setMasterKey] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) || ''
  );

  const login = (key) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setMasterKey(key);
  };
  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setMasterKey('');
  };

  return masterKey ? (
    <CodesPage masterKey={masterKey} onLogout={logout} />
  ) : (
    <LoginView onLogin={login} />
  );
}
