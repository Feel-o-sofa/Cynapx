class Calculator:
    def add(self, a, b):
        return a + b

def multiply(a, b):
    return a * b

def sieve_of_eratosthenes(n):
    """
    에라토스테네스의 체: 순환 복잡도를 테스트하기 위한 여러 제어문 포함
    """
    if n < 2:                         # +1 (if)
        return []
        
    primes = [True for _ in range(n + 1)] # +1 (list comprehension for)
    primes[0] = primes[1] = False
    
    for p in range(2, int(n**0.5) + 1): # +1 (for)
        if primes[p]:                   # +1 (if)
            for i in range(p * p, n + 1, p): # +1 (for)
                primes[i] = False
                
    result = []
    for i in range(2, n + 1):           # +1 (for)
        if primes[i]:                    # +1 (if)
            result.append(i)
            
    return result

if __name__ == "__main__":
    calc = Calculator()
    print(sieve_of_eratosthenes(30))
