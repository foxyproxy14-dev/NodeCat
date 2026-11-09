using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace NodeCat
{
    /// <summary>JSON mínimo: escribe diccionarios, listas, textos, números y booleanos; lee a Dictionary/List.</summary>
    public static class Json
    {
        public static string Escribir(object valor)
        {
            var sb = new StringBuilder();
            Escribir(sb, valor);
            return sb.ToString();
        }

        static void Escribir(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            if (v is string) { Texto(sb, (string)v); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is DateTime) { sb.Append(Utiles.Ms((DateTime)v).ToString(CultureInfo.InvariantCulture)); return; }
            if (v is int || v is long || v is short || v is uint || v is ulong)
            {
                sb.Append(Convert.ToInt64(v).ToString(CultureInfo.InvariantCulture)); return;
            }
            if (v is double || v is float || v is decimal)
            {
                double d = Convert.ToDouble(v);
                if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
                sb.Append(d.ToString("0.###", CultureInfo.InvariantCulture)); return;
            }
            var dic = v as IDictionary;
            if (dic != null)
            {
                sb.Append('{');
                bool primero = true;
                foreach (DictionaryEntry e in dic)
                {
                    if (!primero) sb.Append(',');
                    primero = false;
                    Texto(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                    sb.Append(':');
                    Escribir(sb, e.Value);
                }
                sb.Append('}');
                return;
            }
            var lista = v as IEnumerable;
            if (lista != null)
            {
                sb.Append('[');
                bool primero = true;
                foreach (var x in lista)
                {
                    if (!primero) sb.Append(',');
                    primero = false;
                    Escribir(sb, x);
                }
                sb.Append(']');
                return;
            }
            Texto(sb, v.ToString());
        }

        static void Texto(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '<': sb.Append("\\u003c"); break;
                    case '>': sb.Append("\\u003e"); break;
                    case '&': sb.Append("\\u0026"); break;
                    default:
                        if (c < 0x20 || (int)c == 0x2028 || (int)c == 0x2029) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ---------------------------------------------------------------- lectura
        public static object Leer(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return new Dictionary<string, object>();
            int i = 0;
            var v = Valor(s, ref i);
            Espacios(s, ref i);
            if (i != s.Length) throw new FormatException("JSON no válido.");
            return v;
        }

        public static Dictionary<string, object> LeerObjeto(string s)
        {
            var o = Leer(s) as Dictionary<string, object>;
            if (o == null) throw new FormatException("Se esperaba un objeto JSON.");
            return o;
        }

        static void Espacios(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static object Valor(string s, ref int i)
        {
            Espacios(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON incompleto.");
            char c = s[i];
            if (c == '{')
            {
                var d = new Dictionary<string, object>(StringComparer.Ordinal);
                i++; Espacios(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    Espacios(s, ref i);
                    string k = Cadena(s, ref i);
                    Espacios(s, ref i);
                    if (i >= s.Length || s[i] != ':') throw new FormatException("Falta ':' en JSON.");
                    i++;
                    d[k] = Valor(s, ref i);
                    Espacios(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == '}') { i++; return d; }
                    throw new FormatException("JSON no válido.");
                }
            }
            if (c == '[')
            {
                var l = new List<object>();
                i++; Espacios(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Valor(s, ref i));
                    Espacios(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == ']') { i++; return l; }
                    throw new FormatException("JSON no válido.");
                }
            }
            if (c == '"') return Cadena(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int ini = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (ini == i) throw new FormatException("JSON no válido.");
            return double.Parse(s.Substring(ini, i - ini), CultureInfo.InvariantCulture);
        }

        static string Cadena(string s, ref int i)
        {
            if (i >= s.Length || s[i] != '"') throw new FormatException("Se esperaba un texto en JSON.");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("JSON no válido.");
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber));
                        i += 4;
                        break;
                    default: sb.Append(e); break;
                }
            }
            throw new FormatException("Texto JSON sin cerrar.");
        }

        // ---------------------------------------------------------------- ayudas
        public static string Txt(Dictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return "";
            if (v is double) return ((double)v).ToString(CultureInfo.InvariantCulture);
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static int Num(Dictionary<string, object> o, string k, int defecto)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return defecto;
            if (v is double) return (int)(double)v;
            int r;
            return int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out r) ? r : defecto;
        }

        public static List<object> Lista(Dictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v)) return new List<object>();
            return (v as List<object>) ?? new List<object>();
        }
    }
}
