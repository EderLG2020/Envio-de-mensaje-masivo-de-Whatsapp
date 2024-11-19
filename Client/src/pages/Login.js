import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // Importar useNavigate para redirigir
import './Login.css';
import { login } from '../api';
import logo from '../assets/isotipo.png';
import background from '../assets/ima_login.png'

function Login() {
    // Definir estados para usuario, contraseña y mensajes de error
    const [user, setUser] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    // Hook para redirigir
    const navigate = useNavigate();

    // Función para manejar el inicio de sesión
    const handleLogin = async () => {
        try {
            // Llama a la función de login con los valores actuales de usuario y contraseña
            const response = await login(user, password);

            const data = response.message;

            // Verifica si la respuesta tiene estatus 200 y el acceso es true
            if (data.estatus === 200) {
                console.log(response.message)
                console.log('Login exitoso:', response);

                // Almacenar token en el localStorage (opcional)
                localStorage.setItem('token', data.token);

                // Redirigir al usuario al dashboard
                navigate('/campanas');
            } else {
                // Mostrar mensaje de error si estatus no es 200 o acceso es false
                setError('Error al iniciar sesión. Verifique sus credenciales.');
            }
        } catch (error) {
            // Manejar errores de inicio de sesión
            setError('Error al iniciar sesión. Verifique sus credenciales.');
            console.error('Error al intentar iniciar sesión:', error);
        }
    };

    // Manejar la tecla Enter para enviar el formulario
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Enter') {
                handleLogin();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [user, password]);

    return (
        <div className='body'>
            {/* <img className='background-login' src={background} /> */}
            <div className='contentLogin'>
                <div className='boximage'>
                    <img className='image' src={logo} alt="Isotipo" />
                </div>
                <div className='welcome'>
                    <h1>Bienvenido</h1>
                    <p>En este portal podrás enviar mensajería masiva mediante WhatsApp. Por favor ingresa tus credenciales.</p>
                </div>
                <div className='boxInput'>
                    <input
                        id='user'
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        placeholder='Ingresa tu usuario'
                    />
                    <input
                        id='password'
                        type='password'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder='Ingresa tu contraseña'
                    />
                    {error && <p className='error-message'>{error}</p>}
                    <button id='send' onClick={handleLogin}>Ingresar</button>
                </div>
            </div>
        </div>
    );
}

export default Login;
