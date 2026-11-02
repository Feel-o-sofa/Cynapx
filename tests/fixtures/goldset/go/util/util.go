package util

func Format(n int) string {
	return "#"
}

func Log(msg string) {}

func Factorial(n int) int {
	if n <= 1 {
		return 1
	}
	return n * Factorial(n-1)
}
