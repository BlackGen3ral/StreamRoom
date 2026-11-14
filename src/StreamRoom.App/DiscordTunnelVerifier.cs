using System.IO;
using System.Net;

namespace StreamRoom.App;

internal sealed record DiscordProbeResult(string Url, IPAddress? Address, string Country, string Error);
internal sealed record VerifiedDiscordTunnel(DiscordProtonProfile Profile, string Address);

internal interface IDiscordTunnelProbe
{
    Task<DiscordProbeResult> ReadAsync(bool isolated, string url);
    Task StartAsync(DiscordProtonProfile profile);
    Task StopAsync();
}

internal static class DiscordTunnelVerifier
{
    private static readonly string[] Endpoints = ["https://www.cloudflare.com/cdn-cgi/trace", "https://1.1.1.1/cdn-cgi/trace"];

    public static async Task<VerifiedDiscordTunnel> VerifyAsync(DiscordProtonProfile profile, IDiscordTunnelProbe probe, Action<string> progress)
    {
        var baselines = await Task.WhenAll(Endpoints.Select(async url =>
        {
            var direct = probe.ReadAsync(isolated: false, url);
            var isolated = probe.ReadAsync(isolated: true, url);
            await Task.WhenAll(direct, isolated);
            return (Direct: await direct, Isolated: await isolated);
        }));
        if (baselines.All(pair => pair.Direct.Address is null))
            throw new IOException($"O teste de internet sem VPN falhou. Confira a conexão deste PC. (VPN-DIRETA: {Codes(baselines.Select(pair => pair.Direct))})");
        // The same executable must work outside the tunnel, too. This separates
        // process/security restrictions from a failure introduced by the VPN.
        var usable = baselines.Where(pair => pair.Direct.Address is not null && pair.Isolated.Address is not null).ToArray();
        if (usable.Length == 0)
            throw new IOException($"O Windows não conseguiu executar o teste HTTPS antes de ligar a VPN. Confira se um programa de segurança está bloqueando o teste do StreamRoom. (VPN-TESTE-LOCAL: {Codes(baselines.Select(pair => pair.Isolated))})");
        if (usable.Any(pair => !pair.Direct.Address!.Equals(pair.Isolated.Address)))
            throw new IOException("O teste já está usando outra rota antes de ligar a VPN. Desconecte outras VPNs e confira as regras globais do WireSock. (VPN-BASE-FILTRO)");
        var routes = usable.Select(pair => pair.Direct).ToArray();
        try { return new(profile, await AttemptAsync(profile, probe, routes)); }
        catch (ProbeTransportException) when (profile.TrySmallerPackets() is not null)
        {
            progress("Ajustando o tamanho dos pacotes e repetindo o teste seguro…");
            var compatible = profile.TrySmallerPackets()!;
            try { return new(compatible, await AttemptAsync(compatible, probe, routes)); }
            catch (ProbeTransportException ex)
            {
                throw new IOException($"O teste HTTPS falhou também com pacotes menores. A saída pelos EUA não foi confirmada; a configuração não foi aplicada. (VPN-TRANSPORTE: {ex.Code}; MTU 1280)", ex);
            }
        }
    }

    private static async Task<string> AttemptAsync(DiscordProtonProfile profile, IDiscordTunnelProbe probe, DiscordProbeResult[] baselines)
    {
        Exception? failure = null;
        try
        {
            await probe.StartAsync(profile);
            return await ConfirmRouteAsync(baselines, probe);
        }
        catch (Exception ex) { failure = ex; throw; }
        finally
        {
            try { await probe.StopAsync(); }
            catch (Exception ex) when (failure is not null && ex is IOException or UnauthorizedAccessException)
            {
                // Never retry or proceed until the previous tunnel is stopped.
                // Keep the primary error visible if cleanup fails as well.
                throw new IOException(failure.Message + " Não foi possível confirmar o encerramento do túnel de teste. Desconecte o WireSock antes de tentar novamente. (VPN-LIMPEZA)", failure);
            }
        }
    }

    private static async Task<string> ConfirmRouteAsync(DiscordProbeResult[] baselines, IDiscordTunnelProbe probe)
    {
        var failures = new List<DiscordProbeResult>();
        var directFailed = false;
        string? routeError = null;
        foreach (var baseline in baselines)
        {
            var tunneled = await probe.ReadAsync(isolated: true, baseline.Url);
            if (tunneled.Address is null) { failures.Add(tunneled); continue; }
            var direct = await probe.ReadAsync(isolated: false, baseline.Url);
            if (direct.Address is null) { directFailed = true; failures.Add(direct); continue; }
            if (!direct.Address.Equals(baseline.Address))
                throw new IOException("A conexão normal do PC também mudou durante o teste. Em WireSock → Preferências → Rede, confira se as regras globais estão substituindo as do perfil. (VPN-ROTA-DIRETA)");
            if (tunneled.Address.Equals(baseline.Address))
            {
                routeError = "O teste saiu pela mesma conexão do PC. Em WireSock → Preferências → Rede, confira se as regras globais estão substituindo as do perfil. (VPN-ROTA-FILTRO)";
                continue;
            }
            if (tunneled.Country != "US")
            {
                routeError = $"A saída da VPN foi identificada como {tunneled.Country}. Gere outro perfil WireGuard em um servidor gratuito dos EUA e importe no StreamRoom. (VPN-ROTA-PAÍS)";
                continue;
            }
            return tunneled.Address.ToString();
        }
        if (routeError is not null) throw new IOException(routeError);
        var code = Codes(failures);
        // Certificate errors and direct-route failures must never be accepted
        // by packet-size recovery. Every attempt retains HTTPS validation.
        if (!directFailed && failures.Count > 0 && failures.All(result => CanRetryTransport(result.Error)))
            throw new ProbeTransportException(code);
        throw new IOException($"O teste HTTPS não conseguiu verificar a conexão. A configuração não foi aplicada. (VPN-TESTE: {code})");
    }

    private static bool CanRetryTransport(string code) => code.Split("; ", StringSplitOptions.None).All(part =>
        new[] { 28, 35, 52, 55, 56 }.Any(exit => part == $"curl {exit}") || part == "tempo esgotado");

    private static string Codes(IEnumerable<DiscordProbeResult> results) =>
        string.Join(", ", results.Select(result => result.Error).Where(error => error.Length > 0).Distinct());

    private sealed class ProbeTransportException(string code)
        : IOException($"O teste HTTPS pelo túnel falhou. A configuração não foi aplicada. (VPN-TRANSPORTE: {code})")
    {
        public string Code { get; } = code;
    }
}
