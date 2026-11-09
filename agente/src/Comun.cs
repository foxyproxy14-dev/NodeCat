using System;
using System.Collections.Generic;
using System.Threading;

namespace NodeCat
{
    /// <summary>Contador de lecturas en curso (para no apilar consultas colgadas).</summary>
    public class Contador { public int N; }

    /// <summary>Lo que se recuerda de cada servidor entre consultas.</summary>
    public class Control
    {
        public volatile bool EnCurso;
        public DateTime Inicio;
        public int FallosSeguidos;
        public string Via;                      // "WMI" o "WinRM": la que funcionó la última vez
        public bool AvisadoLento;
        public readonly Contador Wts = new Contador(), Wmi = new Contador(), WinRm = new Contador(), HyperV = new Contador();
        public readonly Dictionary<string, string> Equipos = new Dictionary<string, string>();   // id|usuario|estado -> equipo de origen
    }

    public static class Limite
    {
        /// <summary>Ejecuta f en un hilo propio y espera como mucho "segundos". Si se cuelga, se abandona sin bloquear lo demás.</summary>
        public static T Ejecutar<T>(Func<T> f, int segundos, string que, Contador enCurso, bool sta = false)
        {
            if (Interlocked.CompareExchange(ref enCurso.N, 0, 0) > 0)
                throw new TimeoutException(que + ": la consulta anterior todavía no ha terminado");
            T res = default(T);
            Exception error = null;
            Interlocked.Increment(ref enCurso.N);
            var t = new Thread(() =>
            {
                try { res = f(); }
                catch (Exception ex) { error = ex; }
                finally { Interlocked.Decrement(ref enCurso.N); }
            }) { IsBackground = true, Name = "NodeCat-" + que };
            if (sta) t.SetApartmentState(ApartmentState.STA);
            t.Start();
            if (!t.Join(TimeSpan.FromSeconds(segundos))) throw new TimeoutException(que + " no respondió en " + segundos + " s");
            if (error != null) throw error;
            return res;
        }
    }
}
