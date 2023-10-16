import './style.css'

const apikey = 'test-Z9EB05N-07FMA5B-PYFEE46-X4ECYAR'
const buildingMeterId = '6514167223e3d1424bf82742'
const openvoltApiUrl = 'https://api.openvolt.com/v1/interval-data'
const carbonIntensityApiUrl = 'https://api.carbonintensity.org.uk/'

const commonHeaders = {
  accept: 'application/json'
}

type OpenvoltIntervalData = {
  startInterval: string
  endInterval: string
  granularity: 'hh'
  data: {
    consumption: string
    consumption_units: 'kWh'
    customer_id: string
    meter_id: string
    meter_number: string
    start_interval: string
  }[]
}
const getBuildingEnergyConsumption = async () => {
  try {
    const headers = new Headers(commonHeaders)
    headers.set('x-api-key', apikey)

    const queryParameters = new URLSearchParams({
      meter_id: buildingMeterId,
      start_date: '2023-01-01T00:00:00Z',
      end_date: '2023-01-31T23:59:59Z',
      granularity: 'hh'
    })
    const response = await fetch(`${openvoltApiUrl}?${queryParameters}`, {
      headers
    })
    const data = (await response.json()) as OpenvoltIntervalData
    console.log(data)
    return data
  } catch (error) {
    throw error
  }
}

type CarbonIntensityData = {
  from: string
  to: string
  intensity: {
    forecast: number
    actual: number
    index: string
  }
}
const getCarbonIntensity = async (from: string, to: string) => {
  const headers = new Headers({
    ...commonHeaders
  })

  try {
    const response = await fetch(
      `${carbonIntensityApiUrl}intensity/${from}/${to}`,
      {
        headers
      }
    )
    const data = (await response.json()) as { data: CarbonIntensityData[] }
    return data.data
  } catch (error) {
    throw error
  }
}

type GenerationMixData = {
  from: string
  to: string
  generationmix: {
    fuel: string
    perc: number
  }[]
}
const getGenerationMix = async (from: string, to: string) => {
  const headers = new Headers({
    ...commonHeaders
  })

  try {
    const response = await fetch(
      `${carbonIntensityApiUrl}generation/${from}/${to}`,
      {
        headers
      }
    )
    const data = (await response.json()) as { data: GenerationMixData[] }
    return data.data
  } catch (error) {
    throw error
  }
}

const getFuelMixWeightedAverage = async (
  from: string,
  to: string,
  readingsExpected?: number
) => {
  const generationMixData = await getGenerationMix(from, to)
  if (readingsExpected && generationMixData.length !== readingsExpected) {
    throw new Error(
      'Generation mix data does not match expected number of readings'
    )
  }

  const sum = {
    gas: 0,
    coal: 0,
    biomass: 0,
    nuclear: 0,
    hydro: 0,
    imports: 0,
    other: 0,
    wind: 0,
    solar: 0
  } as { [key: string]: number }

  for (let i = 0; i < generationMixData.length; i++) {
    const element = generationMixData[i]
    for (let j = 0; j < element.generationmix.length; j++) {
      const fuel = element.generationmix[j]
      sum[fuel.fuel] += fuel.perc
    }
  }

  const numDataPoints = generationMixData.length
  const monthlyWeightedAverage = Object.fromEntries(
    Object.entries(sum).map(([key, value]) => [key, value / numDataPoints])
  )

  for (const fuel in sum) {
    monthlyWeightedAverage[fuel] = sum[fuel] / numDataPoints
  }

  return monthlyWeightedAverage
}

type GetStats = () => Promise<{
  buildingEnergyConsumption: number
  amountOfCO2: number
  fuelMix: Record<string, number>
}>
const getStats: GetStats = async () => {
  const buildingEnergyConsumptionData = await getBuildingEnergyConsumption()

  const buildingEnergyConsumption = buildingEnergyConsumptionData.data.reduce(
    (acc, curr) => {
      return (acc += Number(curr.consumption))
    },
    0
  )

  const carbonIntensityData = await getCarbonIntensity(
    buildingEnergyConsumptionData.startInterval,
    buildingEnergyConsumptionData.endInterval
  )
  if (
    carbonIntensityData.length !== buildingEnergyConsumptionData.data.length
  ) {
    throw new Error(
      'Carbon intensity data does not match building energy consumption data'
    )
  }

  const amountOfCO2InG = carbonIntensityData.reduce((acc, curr) => {
    return (acc += curr.intensity.actual)
  }, 0)
  const amountOfCO2InKg = amountOfCO2InG / 1000

  const fuelMix = await getFuelMixWeightedAverage(
    buildingEnergyConsumptionData.startInterval,
    buildingEnergyConsumptionData.endInterval,
    carbonIntensityData.length
  )

  const response = {
    buildingEnergyConsumption,
    amountOfCO2: amountOfCO2InKg,
    fuelMix
  }

  return response
}

const answer = await getStats()
console.log(answer)

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
   Building Energy Consumption: ${answer.buildingEnergyConsumption} kWh </br>
   Amount of CO2 produced: ${answer.amountOfCO2}kg </br>
   Fuel Mix: </br>
   <code>
    ${Object.keys(answer.fuelMix).reduce((acc, curr) => {
      return (acc += `~ ${curr}: ${answer.fuelMix[
        curr as keyof typeof answer.fuelMix
      ].toFixed(2)}% </br>`)
    }, '')}
    </code>
  </div>
`
