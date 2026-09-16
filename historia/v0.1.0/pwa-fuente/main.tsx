import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import "./estilos.css";

const clienteDeConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // El servidor está en la MISMA máquina: volver a pedir cuesta menos de
      // un milisegundo. Se prefiere dato fresco antes que ahorrar una llamada.
      staleTime: 2_000,
      refetchOnWindowFocus: true,
      // Un reintento y basta. Si el servidor local no responde, insistir solo
      // retrasa el momento en que la pantalla dice lo que pasa.
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <QueryClientProvider client={clienteDeConsultas}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// El service worker solo en producción: en desarrollo sirve versiones viejas y
// hace perder tiempo persiguiendo cambios que sí se guardaron.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sin service worker el POS funciona igual: solo pierde el arranque
      // instantáneo. No vale la pena molestar al usuario con esto.
    });
  });
}
