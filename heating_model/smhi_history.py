# Auto-generated SMHI history acquisition
#
# This script downloads CSV archives from the swedish meteorological services
# based on a given station ID.
#
# 2026, section5.se
#
import io
import requests
import pandas as pd

# Vi testar med Göteborgs station (Station ID: 97200)
STATION_ID = 97200

def download_and_parse_smhi_csv(station_id, parameter_id = 1, cachefile = None):
	"""
	Laddar ner och strukturerar historisk CSV-data från SMHI (corrected-archive).
	Standard-parameter är 1 (Lufttemperatur, momentanvärde en gång per timme).
	"""
	url = f"https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/{parameter_id}/station/{station_id}/period/corrected-archive/data.csv"
	
	print(f"Anropar SMHI för station {station_id}...{url}")
	
	try:
		# Skicka anropet till SMHI (ingen API-nyckel krävs)
		response = requests.get(url, timeout=30)
		response.raise_for_status()
		
		# SMHI:s filer börjar med rader av metadata.
		# Vi delar upp texten för att hitta rubrikraden.
		content = response.text
		lines = content.split('\n')

		if cachefile:
			with open(cachefile, "w") as f:
				f.write(content)
				f.close()

		header_idx = -1
		for i, line in enumerate(lines):
			# Rubrikraden innehåller alltid dessa två kolumnnamn
			if "Datum" in line and "Tid" in line:
				header_idx = i
				break
		
		if header_idx == -1:
			raise ValueError("Kunde inte identifiera startpunkten för datatabellen i CSV-filen.")
			
		# Skapa en ren CSV-sträng från och med rubrikraden
		clean_csv_data = "\n".join(lines[header_idx:])
		
		# SMHI använder semikolon (;) som separator
		df = pd.read_csv(io.StringIO(clean_csv_data), sep=';')
		
		# Tvätta bort eventuella dolda mellanslag i kolumnnamnen
		df.columns = [col.strip() for col in df.columns]
		
		# Slå ihop Datum och Tid till ett snyggt index i Pandas (standardiserat till UTC)
		if 'Datum' in df.columns and 'Tid (UTC)' in df.columns:
			df['Timestamp'] = pd.to_datetime(df['Datum'] + ' ' + df['Tid (UTC)'])
			df.set_index('Timestamp', inplace=True)
			df.drop(columns=['Datum', 'Tid (UTC)'], inplace=True, errors='ignore')
			
		# Döp om temperaturkolumnen till något mer lätthanterligt
		if 'Lufttemperatur' in df.columns:
			df.rename(columns={'Lufttemperatur': 'Temperatur_C'}, inplace=True)
			
		# Behåll bara de mest relevanta kolumnerna (Värde och Kvalitet)
		columns_to_keep = ['Temperatur_C', 'Kvalitet']
		df = df[[col for col in columns_to_keep if col in df.columns]]
		
		print(f"Klart! Totalt laddades {len(df)} rader med historisk data ner.")
		return df
		
	except requests.exceptions.HTTPError as e:
		if response.status_code == 404:
			print(f"Fel: Stationen {station_id} saknar ett 'corrected-archive' för denna parameter.")
		else:
			print(f"HTTP-fel uppstod: {e}")
		return None
	except Exception as e:
		print(f"Ett fel uppstod vid hantering av data: {e}")
		return None


def extract_and_interpolate_temp(df, start_time, end_time, time_step="10s"):
	"""
	Klipper ut en specifik tidsperiod från SMHI-DataFramen och interpolerar
	temperaturen linjärt baserat på ett valfritt tidssteg (t.ex. '10s', '1min').
	"""
	# 1. Säkerställ att tidssträngarna tolkas korrekt
	start = pd.to_datetime(start_time)
	end = pd.to_datetime(end_time)
	
	# 2. Filtrera ut det önskade tidsfönstret ur SMHI-datan
	# Vi expanderar fönstret med ±1 timme i kanterna för att säkerställa att 
	# interpoleringen har värden att räkna på även i början och slutet.
	expanded_start = start - pd.Timedelta(hours=1)
	expanded_end = end + pd.Timedelta(hours=1)
	df_slice = df.loc[expanded_start:expanded_end][['Temperatur_C']].copy()
	
	if df_slice.empty:
		raise ValueError("Ingen data hittades för den angivna tidsperioden.")
		
	# 3. Skapa upp den nya täta tidsaxeln som din simulering kräver
	new_index = pd.date_range(start=start, end=end, freq=time_step, name='Timestamp')
	
	# 4. Lägg till de nya tomma simuleringsstegen i vår SMHI-data
	# (Resample skapar strukturen, concat lägger till de exakta simuleringspunkterna)
	combined_df = df_slice.reindex(df_slice.index.union(new_index))
	
	# 5. Gör den linjära interpoleringen över de tomma hålen
	combined_df['Temperatur_C'] = combined_df['Temperatur_C'].interpolate(method='linear')
	
	# 6. Klipp ut exakt det simuleringsfönster som användaren bad om från början
	final_simulation_df = combined_df.reindex(new_index)
	
	return final_simulation_df

# --- SÅ HÄR ANVÄNDER DU DET I DIN SIMULERING ---
# (Vi antar att variabeln 'weather_data' innehåller din DataFrame från förra steget)

def parse_local_smhi_csv(file_path):
	"""
	Read local SMI CSV archive
	"""
	# 1. Scan for tags
	skip_rows = 0
	with open(file_path, 'r', encoding='utf-8') as f:
		for i, line in enumerate(f):
			if "Datum" in line and "Tid" in line:
				skip_rows = i
				break

	# 2. Read in CSV and skip meta data
	df = pd.read_csv(file_path, sep=';', skiprows=skip_rows)
	
	# 3. Clean up some
	df.columns = [col.strip() for col in df.columns]
	
	# 4. change time index
	if 'Datum' in df.columns and 'Tid (UTC)' in df.columns:
		df['Timestamp'] = pd.to_datetime(df['Datum'] + ' ' + df['Tid (UTC)'])
		df.set_index('Timestamp', inplace=True)
	
	# 5. rename the temp column
	if 'Lufttemperatur' in df.columns:
		df.rename(columns={'Lufttemperatur': 'Temperatur_C'}, inplace=True)
		
	return df[['Temperatur_C', 'Kvalitet']]

if __name__ == "__main__":
	from pathlib import Path
	data = Path("./data.csv")
	if data.is_file():
		df = parse_local_smhi_csv("data.csv")
	else:
		df = download_and_parse_smhi_csv(STATION_ID, cachefile = "data.csv")

		if df is None:
			raise ValueError("Fick ingen data")


	# Definiera exakt vilken period du vill köra din värmepumpsimulering på
	start_sim = "2023-01-15 08:00:00"
	end_sim   = "2023-01-15 12:00:00"  # 4 timmars simulering
	step_size = "10s"				   # Samma dt (10 sekunder) som din fysikmodell
	
	# Hämta den perfekt interpolerade utetemperaturen
	sim_ambient_temps = extract_and_interpolate_temp(df, start_sim, end_sim, time_step=step_size)
	
	print(f"Generate time index interpolation with freq: {step_size}")
	print("-" * 60)
	print(sim_ambient_temps.head(10)) # Visar de första stegen (sekunderna)
	print("...")
	print(sim_ambient_temps.tail(5))  # Visar slutet på simuleringen
	
	# För att använda i din loop kan du enkelt göra om kolumnen till en vanlig Python-lista eller array:
	# temp_input_list = sim_ambient_temps['Temperatur_C'].to_numpy()


