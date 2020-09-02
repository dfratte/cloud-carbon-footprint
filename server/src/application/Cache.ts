import { EstimationResult } from '@application/EstimationResult'
import EstimatorCacheInMemory from '@application/EstimatorCacheInMemory'
import EstimatorCache from '@application/EstimatorCache'
import moment, { Moment } from 'moment'
import { RawRequest } from '@view/RawRequest'

const cacheService: EstimatorCache = new EstimatorCacheInMemory()

function getMissingDataRequests(cachedEstimates: EstimationResult[], request: RawRequest): RawRequest[] {
  const cachedDates: Moment[] = cachedEstimates.map(({ timestamp }) => {
    return moment.utc(timestamp)
  })
  cachedDates.sort((a, b) => {
    return a.date() - b.date()
  })

  const missingDates: Moment[] = []
  const dateIndex = moment.utc(request.startDate)
  for (let i = 0; i < cachedDates.length; i++) {
    while (dateIndex.isBefore(cachedDates[i])) {
      missingDates.push(moment.utc(dateIndex.toDate()))
      dateIndex.add(1, 'day')
    }
    dateIndex.add(1, 'day')
  }

  while (dateIndex.isBefore(moment.utc(request.endDate))) {
    missingDates.push(moment.utc(dateIndex.toDate()))
    dateIndex.add(1, 'day')
  }

  const groupMissingDates = missingDates.reduce((acc, date) => {
    const lastSubArray = acc[acc.length - 1]

    if (
      !lastSubArray ||
      !moment
        .utc(date)
        .subtract(1, 'day')
        .isSame(lastSubArray[lastSubArray.length - 1])
    ) {
      acc.push([])
    }

    acc[acc.length - 1].push(date.clone())

    return acc
  }, [])

  const requestDates = groupMissingDates.map((group) => {
    return {
      start: group[0],
      end: group[group.length - 1].add('1', 'day'),
    }
  })

  return requestDates.map((dates) => {
    return {
      startDate: dates.start.utc().toISOString(),
      endDate: dates.end.utc().toISOString(),
      region: request.region,
    }
  })
}

async function computeEstimates(originalRequests: any[]) {
  return (await Promise.all(originalRequests)).flat()
}

function concat(cachedEstimates: EstimationResult[], estimates: EstimationResult[]) {
  return cachedEstimates.concat(estimates).sort((a, b) => {
    return a.timestamp.getTime() - b.timestamp.getTime()
  })
}

export default function cache(): any {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalFunction = descriptor.value

    descriptor.value = async (...args: any[]): Promise<EstimationResult[]> => {
      const request: RawRequest = args[0]
      const cachedEstimates: EstimationResult[] = await cacheService.getEstimates(request)

      if (!cachedEstimates) return await originalFunction.apply(target, args)

      const middlewareRequest = getMissingDataRequests(cachedEstimates, request)
      const originalRequests = middlewareRequest.map((request) => {
        return originalFunction.apply(target, [request])
      })

      const estimates: EstimationResult[] = await computeEstimates(originalRequests)
      cacheService.setEstimates(estimates)
      return concat(cachedEstimates, estimates)
    }
  }
}