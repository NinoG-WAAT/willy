/**
 * Outlook and Exchange write Windows time zone names ("W. Europe Standard Time") in TZID, not IANA
 * names. This is the CLDR windowsZones table (primary territory per Windows zone), so a Windows
 * zone resolves to one representative IANA zone whose rules match for scheduling purposes.
 * Source: unicode-org/cldr supplemental/windowsZones.xml, territory 001.
 */
export const WINDOWS_TO_IANA: Readonly<Record<string, string>> = {
  "AUS Central Standard Time": "Australia/Darwin",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Afghanistan Standard Time": "Asia/Kabul",
  "Alaskan Standard Time": "America/Anchorage",
  "Aleutian Standard Time": "America/Adak",
  "Altai Standard Time": "Asia/Barnaul",
  "Arab Standard Time": "Asia/Riyadh",
  "Arabian Standard Time": "Asia/Dubai",
  "Arabic Standard Time": "Asia/Baghdad",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Astrakhan Standard Time": "Europe/Astrakhan",
  "Atlantic Standard Time": "America/Halifax",
  "Aus Central W. Standard Time": "Australia/Eucla",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Azores Standard Time": "Atlantic/Azores",
  "Bahia Standard Time": "America/Bahia",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Belarus Standard Time": "Europe/Minsk",
  "Bougainville Standard Time": "Pacific/Bougainville",
  "Canada Central Standard Time": "America/Regina",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "Central America Standard Time": "America/Guatemala",
  "Central Asia Standard Time": "Asia/Almaty",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Central Pacific Standard Time": "Pacific/Guadalcanal",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Chatham Islands Standard Time": "Pacific/Chatham",
  "China Standard Time": "Asia/Shanghai",
  "Cuba Standard Time": "America/Havana",
  "Dateline Standard Time": "Etc/GMT+12",
  "E. Africa Standard Time": "Africa/Nairobi",
  "E. Australia Standard Time": "Australia/Brisbane",
  "E. Europe Standard Time": "Europe/Chisinau",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Easter Island Standard Time": "Pacific/Easter",
  "Eastern Standard Time": "America/New_York",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Egypt Standard Time": "Africa/Cairo",
  "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
  "FLE Standard Time": "Europe/Kyiv",
  "Fiji Standard Time": "Pacific/Fiji",
  "GMT Standard Time": "Europe/London",
  "GTB Standard Time": "Europe/Bucharest",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Greenland Standard Time": "America/Nuuk",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Haiti Standard Time": "America/Port-au-Prince",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "India Standard Time": "Asia/Kolkata",
  "Iran Standard Time": "Asia/Tehran",
  "Israel Standard Time": "Asia/Jerusalem",
  "Jordan Standard Time": "Asia/Amman",
  "Kaliningrad Standard Time": "Europe/Kaliningrad",
  "Korea Standard Time": "Asia/Seoul",
  "Libya Standard Time": "Africa/Tripoli",
  "Line Islands Standard Time": "Pacific/Kiritimati",
  "Lord Howe Standard Time": "Australia/Lord_Howe",
  "Magadan Standard Time": "Asia/Magadan",
  "Magallanes Standard Time": "America/Punta_Arenas",
  "Marquesas Standard Time": "Pacific/Marquesas",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Middle East Standard Time": "Asia/Beirut",
  "Montevideo Standard Time": "America/Montevideo",
  "Morocco Standard Time": "Africa/Casablanca",
  "Mountain Standard Time": "America/Denver",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Myanmar Standard Time": "Asia/Yangon",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "Namibia Standard Time": "Africa/Windhoek",
  "Nepal Standard Time": "Asia/Kathmandu",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Newfoundland Standard Time": "America/St_Johns",
  "Norfolk Standard Time": "Pacific/Norfolk",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "North Korea Standard Time": "Asia/Pyongyang",
  "Omsk Standard Time": "Asia/Omsk",
  "Pacific SA Standard Time": "America/Santiago",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "Pakistan Standard Time": "Asia/Karachi",
  "Paraguay Standard Time": "America/Asuncion",
  "Qyzylorda Standard Time": "Asia/Qyzylorda",
  "Romance Standard Time": "Europe/Paris",
  "Russia Time Zone 10": "Asia/Srednekolymsk",
  "Russia Time Zone 11": "Asia/Kamchatka",
  "Russia Time Zone 3": "Europe/Samara",
  "Russian Standard Time": "Europe/Moscow",
  "SA Eastern Standard Time": "America/Cayenne",
  "SA Pacific Standard Time": "America/Bogota",
  "SA Western Standard Time": "America/La_Paz",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Saint Pierre Standard Time": "America/Miquelon",
  "Sakhalin Standard Time": "Asia/Sakhalin",
  "Samoa Standard Time": "Pacific/Apia",
  "Sao Tome Standard Time": "Africa/Sao_Tome",
  "Saratov Standard Time": "Europe/Saratov",
  "Singapore Standard Time": "Asia/Singapore",
  "South Africa Standard Time": "Africa/Johannesburg",
  "South Sudan Standard Time": "Africa/Juba",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Sudan Standard Time": "Africa/Khartoum",
  "Syria Standard Time": "Asia/Damascus",
  "Taipei Standard Time": "Asia/Taipei",
  "Tasmania Standard Time": "Australia/Hobart",
  "Tocantins Standard Time": "America/Araguaina",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Tomsk Standard Time": "Asia/Tomsk",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Transbaikal Standard Time": "Asia/Chita",
  "Turkey Standard Time": "Europe/Istanbul",
  "Turks And Caicos Standard Time": "America/Grand_Turk",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "US Mountain Standard Time": "America/Phoenix",
  UTC: "UTC",
  "UTC+12": "Etc/GMT-12",
  "UTC+13": "Etc/GMT-13",
  "UTC-02": "Etc/GMT+2",
  "UTC-08": "Etc/GMT+8",
  "UTC-09": "Etc/GMT+9",
  "UTC-11": "Etc/GMT+11",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Venezuela Standard Time": "America/Caracas",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Volgograd Standard Time": "Europe/Volgograd",
  "W. Australia Standard Time": "Australia/Perth",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "W. Europe Standard Time": "Europe/Berlin",
  "W. Mongolia Standard Time": "Asia/Hovd",
  "West Asia Standard Time": "Asia/Tashkent",
  "West Bank Standard Time": "Asia/Hebron",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Yukon Standard Time": "America/Whitehorse",
};

// A Map keyed by lower-case name: no prototype keys to trip over, case-insensitive lookup.
const BY_LOWER_NAME: ReadonlyMap<string, string> = new Map([
  ...Object.entries(WINDOWS_TO_IANA).map(([name, zone]) => [name.toLowerCase(), zone] as const),
  // Outlook.com style marker for UTC.
  ["tzone://microsoft/utc", "UTC"],
]);

const MAX_NAME_LENGTH = 100;

/** True when the runtime's tz database knows this IANA zone name. */
export function isIanaZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > MAX_NAME_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the TZID of an ICS property to an IANA zone: Windows names (what Outlook writes) and
 * IANA names (what Teams, Google and Apple write) both work. Returns null for anything else
 * ("Customized Time Zone", display names): the caller reports it, never guesses an offset.
 */
export function resolveIcsTimezone(tzid: string): string | null {
  const name = tzid.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  const windows = BY_LOWER_NAME.get(name.toLowerCase());
  if (windows !== undefined) return windows;
  return /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(name) && isIanaZone(name)
    ? name
    : null;
}
