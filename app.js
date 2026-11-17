// app.js - Lógica de la interfaz, envío resiliente y sincronización
// Versión Tema 5.2 (Patrón Outbox + evento online)

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

const formulario = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

// ---------------------------------------------------------
// Registro del Service Worker
// ---------------------------------------------------------
if ('serviceWorker' in navigator) {
  // Ruta relativa para que funcione en GitHub Pages
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado con scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });
}

// ---------------------------------------------------------
// Indicador de red
// ---------------------------------------------------------
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// ---------------------------------------------------------
// READ: dibujar la bandeja de salida
// ---------------------------------------------------------
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        listaOutbox.innerHTML = '<li class="vacio">No hay registros en la bandeja.</li>';
        return;
      }

      registros.forEach((item) => {
        const li = document.createElement('li');
        li.className = item.estado;

        const hora = new Date(item.fechaCreacion).toLocaleTimeString('es-MX');

        li.innerHTML = `
          <strong></strong><br>
          <span class="estado">${item.estado}</span> -
          <span class="hora">${hora}</span>
        `;
        // textContent para que el título no se interprete como HTML
        li.querySelector('strong').textContent = item.titulo;

        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('Error al leer IndexedDB:', error);
    });
}

// ---------------------------------------------------------
// CREATE: envío resiliente con fallback a IndexedDB
// ---------------------------------------------------------
function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Hubo internet: se guarda como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando transacción localmente...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

// ---------------------------------------------------------
// UPDATE: reenviar pendientes al recuperar la red
// ---------------------------------------------------------
function sincronizarPendientes() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Cada registro pendiente se convierte en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// Escuchar el regreso de la conectividad
window.addEventListener('online', () => {
  actualizarIndicadorRed();
  sincronizarPendientes();
});

window.addEventListener('offline', actualizarIndicadorRed);

// ---------------------------------------------------------
// Envío del formulario
// ---------------------------------------------------------
formulario.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => {
      formulario.reset();
    })
    .catch((error) => {
      console.error('Error al procesar el reporte:', error);
    });
});

// ---------------------------------------------------------
// DELETE: purgar registros ya sincronizados
// ---------------------------------------------------------
btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      const promesasBorrado = sincronizados.map((item) => eliminarRegistro(item.id));
      return Promise.all(promesasBorrado);
    })
    .then(() => {
      console.log('[Outbox] Registros sincronizados purgados.');
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('Error al purgar registros:', error);
    });
});

// ---------------------------------------------------------
// Al cargar la página: READ inicial (rescata lo que quedó en IndexedDB)
// ---------------------------------------------------------
actualizarIndicadorRed();
renderizarColaOutbox();
